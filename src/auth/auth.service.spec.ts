import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { AppConfig } from '../config/configuration';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthContextService } from './auth-context.service';
import { AuthService } from './auth.service';
import { hashPassword } from './password.util';
import type { UserInvitationsService } from './user-invitations.service';

describe('AuthService', () => {
  const jwt = {
    accessSecret: 'access-secret',
    accessExpiresIn: '15m',
    refreshSecret: 'refresh-secret',
    refreshExpiresIn: '7d',
  };

  const activeUser = {
    id: 'user-1',
    email: 'doctor@dev-clinic.test',
    firstName: 'Dev',
    lastName: 'Doctor',
    status: 'ACTIVE',
    isSuperAdmin: false,
  };

  const authContextResult = {
    role: 'Doctor',
    clinicId: 'clinic-1',
    clinicName: 'Dev Clinic',
    permissions: ['appointments:read'],
  };

  function makeService(overrides?: {
    prisma?: Partial<Record<string, unknown>>;
    authContextResolve?: jest.Mock;
  }) {
    const prisma = {
      user: { findUnique: jest.fn() },
      refreshToken: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      ...overrides?.prisma,
    };
    const authContext = {
      resolve: overrides?.authContextResolve ?? jest.fn().mockResolvedValue(authContextResult),
    };
    const jwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    const configService = { get: () => jwt };
    const userInvitations = { accept: jest.fn() };

    const service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
      authContext as unknown as AuthContextService,
      userInvitations as unknown as UserInvitationsService,
      configService as unknown as ConfigService<AppConfig, true>,
    );
    return { service, prisma, authContext, jwtService, userInvitations };
  }

  describe('login', () => {
    it('rejects an unknown email with a generic message', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@test.com', password: 'x' }, '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a wrong password with the same generic message', async () => {
      const { service, prisma } = makeService();
      const passwordHash = await hashPassword('CorrectPassword1!');
      prisma.user.findUnique.mockResolvedValue({ ...activeUser, passwordHash });

      await expect(
        service.login({ email: activeUser.email, password: 'WrongPassword' }, '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a non-ACTIVE (e.g. suspended) user', async () => {
      const { service, prisma } = makeService();
      const passwordHash = await hashPassword('CorrectPassword1!');
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        status: 'SUSPENDED',
        passwordHash,
      });

      await expect(
        service.login({ email: activeUser.email, password: 'CorrectPassword1!' }, '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('issues an access token and a hashed, persisted refresh token on success', async () => {
      const { service, prisma, jwtService } = makeService();
      const passwordHash = await hashPassword('CorrectPassword1!');
      prisma.user.findUnique.mockResolvedValue({ ...activeUser, passwordHash });

      const result = await service.login(
        { email: activeUser.email, password: 'CorrectPassword1!' },
        '127.0.0.1',
      );

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.user).toMatchObject({
        id: activeUser.id,
        role: 'Doctor',
        clinicId: 'clinic-1',
        isSuperAdmin: false,
      });
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: activeUser.id, permissions: authContextResult.permissions }),
        expect.objectContaining({ secret: jwt.accessSecret }),
      );
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- test mock, loosely typed by design */
      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: activeUser.id, clinicId: 'clinic-1' }),
        }),
      );
      // The raw refresh token is never the same value as what's persisted (only its hash is stored).
      const persistedHash = prisma.refreshToken.create.mock.calls[0][0].data.tokenHash as string;
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
      expect(persistedHash).not.toBe(result.refreshToken);
    });
  });

  describe('refresh', () => {
    it('rejects a missing token', async () => {
      const { service } = makeService();
      await expect(service.refresh(undefined, '127.0.0.1')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an unknown token', async () => {
      const { service, prisma } = makeService();
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refresh('raw-token', '127.0.0.1')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an expired token', async () => {
      const { service, prisma } = makeService();
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
        clinicId: 'clinic-1',
      });
      await expect(service.refresh('raw-token', '127.0.0.1')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('detects reuse of an already-revoked token and burns the whole session family', async () => {
      const { service, prisma } = makeService();
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 100_000),
        clinicId: 'clinic-1',
      });

      await expect(service.refresh('raw-token', '127.0.0.1')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', revokedAt: null } }),
      );
    });

    it('rotates the token on a valid refresh: old token revoked, new one issued', async () => {
      const { service, prisma } = makeService();
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 100_000),
        clinicId: 'clinic-1',
      });
      prisma.user.findUnique.mockResolvedValue(activeUser);

      const result = await service.refresh('raw-token', '127.0.0.1');

      expect(result.accessToken).toBe('signed.jwt.token');

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rt-1' },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('revokes all outstanding refresh tokens for the user', async () => {
      const { service, prisma } = makeService();
      await service.logout('user-1');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as Date },
      });
    });
  });

  describe('getMe', () => {
    it('rejects when the account is no longer active', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        status: 'SUSPENDED',
      });
      await expect(service.getMe('user-1', 'clinic-1')).rejects.toThrow(UnauthorizedException);
    });

    it('returns the resolved auth-context profile', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(activeUser);
      const result = await service.getMe('user-1', 'clinic-1');
      expect(result).toMatchObject({
        id: 'user-1',
        role: 'Doctor',
        permissions: authContextResult.permissions,
        isSuperAdmin: false,
      });
    });

    it('reports isSuperAdmin for a super admin account', async () => {
      const { service, prisma, authContext } = makeService({
        authContextResolve: jest.fn().mockResolvedValue({
          role: 'SuperAdmin',
          clinicId: null,
          clinicName: null,
          permissions: ['clinics:read'],
        }),
      });
      prisma.user.findUnique.mockResolvedValue({ ...activeUser, isSuperAdmin: true });
      const result = await service.getMe('user-1', null);
      expect(result).toMatchObject({ isSuperAdmin: true, role: 'SuperAdmin', clinicId: null });
      expect(authContext.resolve).toHaveBeenCalled();
    });
  });

  describe('acceptInvite', () => {
    it('activates the account via UserInvitationsService and issues a session (Phase 1D)', async () => {
      const { service, prisma, userInvitations } = makeService();
      userInvitations.accept.mockResolvedValue({ userId: 'user-1' });
      prisma.user.findUnique.mockResolvedValue(activeUser);

      const result = await service.acceptInvite('raw-token', 'NewPassword123!', '127.0.0.1');

      expect(userInvitations.accept).toHaveBeenCalledWith('raw-token', 'NewPassword123!');
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.user.id).toBe('user-1');
    });

    it('propagates a rejection from UserInvitationsService.accept (invalid/expired token)', async () => {
      const { service, userInvitations } = makeService();
      userInvitations.accept.mockRejectedValue(new Error('Invalid or expired invitation'));

      await expect(service.acceptInvite('bad-token', 'NewPassword123!', undefined)).rejects.toThrow(
        'Invalid or expired invitation',
      );
    });
  });
});
