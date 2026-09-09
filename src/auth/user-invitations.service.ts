import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from './password.util';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface IssuedInvitation {
  /** Raw, unhashed token — only ever returned once, at issuance. Never persisted as-is. */
  token: string;
  expiresAt: Date;
}

/**
 * Set-password invitation flow (Phase 1D — Staff Management), used by
 * StaffService so a clinic admin never sees/sets a staff member's password
 * (docs brief: "Do not send plaintext passwords"). Lives in the auth
 * module — not the staff module — because it is fundamentally an auth/
 * credential concern (activating a login), exported for StaffModule to use
 * per ../../CLAUDE.md rule 11 (module boundaries via exported services).
 *
 * DEPENDENCY NOTE: there is no email/SMS provider wired into this codebase
 * yet (docs/ROADMAP.md Phase 8 marks Email as a *future* NotificationProvider
 * implementation). Until one exists, the raw invite token is returned
 * directly in the staff-create/resend-invite API response for the calling
 * ClinicAdmin to share out-of-band (copy/paste a link) — the same
 * "documented dependency, not built here" treatment CreateDoctorDto already
 * gives its own temporaryPassword-without-invite-flow gap. Wiring an actual
 * EmailProvider to deliver this automatically is follow-up work, not part
 * of this phase.
 */
@Injectable()
export class UserInvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates the User row itself (status PENDING, an unusable random
   * password hash — never a real password, never client-supplied) plus its
   * first invitation. Called only from StaffService.invite, inside the same
   * transaction as the ClinicMembership it belongs to.
   */
  async createPendingUser(
    tx: PrismaTx,
    input: { email: string; firstName: string; lastName: string },
  ): Promise<{ userId: string; invitation: IssuedInvitation }> {
    const unusablePassword = randomBytes(32).toString('hex');
    const user = await tx.user.create({
      data: {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        passwordHash: await hashPassword(unusablePassword),
        status: 'PENDING',
        isSuperAdmin: false,
      },
    });

    const invitation = await this.issue(tx, user.id);
    return { userId: user.id, invitation };
  }

  /** Regenerates (replaces) the invitation for an already-PENDING user — "resend invite". */
  async resend(userId: string): Promise<IssuedInvitation> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'PENDING') {
      throw new BadRequestException('Only a pending staff account can be re-invited');
    }
    return this.issue(this.prisma, userId);
  }

  /**
   * Validates a raw invite token and activates the account: sets a real
   * password hash, flips status PENDING -> ACTIVE, marks the invitation
   * accepted. Returns the activated user for AuthService to log in with.
   */
  async accept(rawToken: string, newPassword: string): Promise<{ userId: string }> {
    const tokenHash = hashInviteToken(rawToken);
    const invitation = await this.prisma.staffInvitation.findUnique({ where: { tokenHash } });

    if (!invitation) throw new BadRequestException('Invalid or expired invitation');
    if (invitation.acceptedAt)
      throw new BadRequestException('This invitation has already been used');
    if (invitation.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException(
        'This invitation has expired — ask your clinic admin to resend it',
      );
    }

    const passwordHash = await hashPassword(newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: invitation.userId },
        data: { passwordHash, status: 'ACTIVE' },
      }),
      this.prisma.staffInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      }),
    ]);

    return { userId: invitation.userId };
  }

  private async issue(tx: PrismaTx, userId: string): Promise<IssuedInvitation> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    // At most one live invitation per user (userId is @unique) — upsert
    // replaces a prior unaccepted one rather than accumulating rows.
    await tx.staffInvitation.upsert({
      where: { userId },
      update: { tokenHash: hashInviteToken(token), expiresAt, acceptedAt: null },
      create: { userId, tokenHash: hashInviteToken(token), expiresAt },
    });

    return { token, expiresAt };
  }
}

function hashInviteToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Narrow structural type covering both PrismaService and a $transaction callback's `tx` — same pattern DepartmentsService/DoctorsService use inline, named here since it's shared by two call sites. */
type PrismaTx = Pick<PrismaService, 'user' | 'staffInvitation'>;
