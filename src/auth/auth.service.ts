import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import type { AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { AuthContextService } from './auth-context.service';
import type { AuthUserDto, LoginResponseDto } from './dto/auth-response.dto';
import type { LoginDto } from './dto/login.dto';
import { verifyPassword } from './password.util';
import { parseDurationMs } from './token-expiry.util';
import { UserInvitationsService } from './user-invitations.service';

interface IssuedSession extends LoginResponseDto {
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

@Injectable()
export class AuthService {
  private readonly jwt: AppConfig['jwt'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly authContext: AuthContextService,
    private readonly userInvitations: UserInvitationsService,
    configService: ConfigService<AppConfig, true>,
  ) {
    this.jwt = configService.get('jwt', { infer: true });
  }

  async login(dto: LoginDto, ip: string | undefined): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    // Same generic message whether the email doesn't exist or the password
    // is wrong — never reveal which (user enumeration).
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid email or password');
    }
    const valid = await verifyPassword(user.passwordHash, dto.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const context = await this.authContext.resolve(user);
    return this.issueSession(user.id, user, context, ip);
  }

  async refresh(rawToken: string | undefined, ip: string | undefined): Promise<IssuedSession> {
    if (!rawToken) throw new UnauthorizedException('Missing refresh token');

    const tokenHash = hashToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!existing) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (existing.revokedAt) {
      // A previously-rotated-out (or already-logged-out) token being
      // presented again means it leaked — burn the whole session family.
      await this.prisma.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.prisma.user.findUnique({ where: { id: existing.userId } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is no longer active');
    }

    const context = await this.authContext.resolve(user, existing.clinicId);
    const session = await this.issueSession(user.id, user, context, ip, existing.clinicId);

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedByTokenHash: hashToken(session.refreshToken) },
    });

    return session;
  }

  /**
   * Phase 1D — Staff Management: sets the staff member's own password from
   * an invite token (UserInvitationsService.accept validates it and
   * activates the account) and immediately logs them in, same session
   * shape as `login`, so accepting an invite lands the user straight in
   * the app instead of a second separate login step.
   */
  async acceptInvite(
    token: string,
    password: string,
    ip: string | undefined,
  ): Promise<IssuedSession> {
    const { userId } = await this.userInvitations.accept(token, password);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is no longer active');
    }
    const context = await this.authContext.resolve(user);
    return this.issueSession(user.id, user, context, ip);
  }

  /** docs/SECURITY.md §1: logout invalidates ALL outstanding refresh tokens for the user, not just the current one. */
  async logout(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getMe(userId: string, sessionClinicId: string | null): Promise<AuthUserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is no longer active');
    }
    const context = await this.authContext.resolve(user, sessionClinicId);
    return toAuthUserDto(
      user.id,
      user.firstName,
      user.lastName,
      user.email,
      user.isSuperAdmin,
      context,
    );
  }

  private async issueSession(
    userId: string,
    user: { id: string; email: string; firstName: string; lastName: string; isSuperAdmin: boolean },
    context: Awaited<ReturnType<AuthContextService['resolve']>>,
    ip: string | undefined,
    pinnedClinicId?: string | null,
  ): Promise<IssuedSession> {
    const accessToken = this.jwtService.sign(
      {
        sub: userId,
        email: user.email,
        role: context.role,
        clinicId: context.clinicId,
        clinicName: context.clinicName,
        isSuperAdmin: user.isSuperAdmin,
        permissions: context.permissions,
      },
      {
        secret: this.jwt.accessSecret,
        expiresIn: parseDurationMs(this.jwt.accessExpiresIn) / 1000,
      },
    );

    const refreshToken = randomBytes(48).toString('hex');
    const refreshTokenExpiresAt = new Date(Date.now() + parseDurationMs(this.jwt.refreshExpiresIn));

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(refreshToken),
        clinicId: pinnedClinicId ?? context.clinicId,
        expiresAt: refreshTokenExpiresAt,
        createdByIp: ip,
      },
    });

    return {
      accessToken,
      refreshToken,
      refreshTokenExpiresAt,
      user: toAuthUserDto(
        userId,
        user.firstName,
        user.lastName,
        user.email,
        user.isSuperAdmin,
        context,
      ),
    };
  }
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function toAuthUserDto(
  id: string,
  firstName: string,
  lastName: string,
  email: string,
  isSuperAdmin: boolean,
  context: {
    role: string | null;
    clinicId: string | null;
    clinicName: string | null;
    permissions: string[];
  },
): AuthUserDto {
  return {
    id,
    name: `${firstName} ${lastName}`.trim(),
    email,
    role: context.role,
    clinicId: context.clinicId,
    clinicName: context.clinicName,
    permissions: context.permissions,
    isSuperAdmin,
  };
}
