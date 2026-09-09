import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AuditActions } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, verifyPassword } from './password.util';
import {
  PASSWORD_RESET_MAILER,
  type PasswordResetMailer,
} from './providers/password-reset-mailer.interface';

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour — short-lived, single-use link.

/**
 * Change/forgot/reset-password flows (docs/SECURITY.md §1). Kept separate
 * from AuthService — which owns login/refresh/logout session issuance — to
 * keep that file focused; this service owns credential mutation instead.
 * Both share password.util's argon2id hashing, and both revoke outstanding
 * refresh tokens on any password change, per docs/SECURITY.md §1: "Logout /
 * password change invalidates all outstanding refresh tokens for that
 * user."
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @Inject(PASSWORD_RESET_MAILER) private readonly mailer: PasswordResetMailer,
  ) {}

  /** Authenticated self-service password change. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ip: string | undefined,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is no longer active');
    }

    const valid = await verifyPassword(user.passwordHash, currentPassword);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException('New password must be different from the current password');
    }

    const passwordHash = await hashPassword(newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.auditService.record({
      actorUserId: userId,
      entity: 'User',
      entityId: userId,
      action: AuditActions.PASSWORD_CHANGED,
      ipAddress: ip,
    });
  }

  /**
   * Issues a reset token and "sends" it (see PasswordResetMailer). Always
   * resolves silently — the controller returns the same generic response
   * whether or not the email matches an account, so this endpoint can't be
   * used to enumerate registered users (docs/SECURITY.md §1/§4 tenet
   * applied here to accounts instead of clinics).
   */
  async requestReset(email: string, ip: string | undefined): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') {
      return;
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);

    // At most one live token per user (userId is @unique) — a fresh request
    // invalidates any earlier unused one instead of accumulating valid links.
    await this.prisma.passwordResetToken.upsert({
      where: { userId: user.id },
      update: { tokenHash: hashResetToken(token), expiresAt, usedAt: null, createdByIp: ip },
      create: { userId: user.id, tokenHash: hashResetToken(token), expiresAt, createdByIp: ip },
    });

    await this.mailer.send({ email: user.email, token, expiresAt });

    await this.auditService.record({
      actorUserId: user.id,
      entity: 'User',
      entityId: user.id,
      action: AuditActions.PASSWORD_RESET_REQUESTED,
      ipAddress: ip,
    });
  }

  /** Completes a reset from a raw token delivered via requestReset(). */
  async reset(rawToken: string, newPassword: string, ip: string | undefined): Promise<void> {
    const tokenHash = hashResetToken(rawToken);
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });

    // Same generic message for "no such token", "already used", and
    // "expired" — never reveal which (mirrors AuthService.login's
    // enumeration-safe generic message for email/password).
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This password reset link is invalid or has expired');
    }

    // Atomically claim the token before touching the password: a
    // conditional update that only succeeds if `usedAt` is still null
    // guards against a concurrent double-submit of the same link redeeming
    // it twice.
    const claim = await this.prisma.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claim.count === 0) {
      throw new BadRequestException('This password reset link is invalid or has expired');
    }

    const passwordHash = await hashPassword(newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.auditService.record({
      actorUserId: record.userId,
      entity: 'User',
      entityId: record.userId,
      action: AuditActions.PASSWORD_RESET_COMPLETED,
      ipAddress: ip,
    });
  }
}

function hashResetToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
