import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit-actions';
import type { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from './password.util';
import { PasswordResetService } from './password-reset.service';

function makeService(overrides?: { prisma?: Partial<Record<string, unknown>> }) {
  const prisma = {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    passwordResetToken: {
      findUnique: jest.fn(),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    ...overrides?.prisma,
  };
  (prisma as Record<string, unknown>).$transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(prisma);
  });

  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const mailer = { send: jest.fn().mockResolvedValue(undefined) };

  const service = new PasswordResetService(
    prisma as unknown as PrismaService,
    auditService as unknown as AuditService,
    mailer,
  );
  return { service, prisma, auditService, mailer };
}

const activeUser = {
  id: 'user-1',
  email: 'doctor@dev-clinic.test',
  status: 'ACTIVE',
};

describe('PasswordResetService', () => {
  describe('changePassword', () => {
    it('rejects when the account is no longer active', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue({ ...activeUser, status: 'SUSPENDED' });

      await expect(
        service.changePassword('user-1', 'whatever', 'NewPassword123!', '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an incorrect current password', async () => {
      const { service, prisma } = makeService();
      const passwordHash = await hashPassword('CorrectPassword1!');
      prisma.user.findUnique.mockResolvedValue({ ...activeUser, passwordHash });

      await expect(
        service.changePassword('user-1', 'WrongPassword', 'NewPassword123!', '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a new password identical to the current one', async () => {
      const { service, prisma } = makeService();
      const passwordHash = await hashPassword('CorrectPassword1!');
      prisma.user.findUnique.mockResolvedValue({ ...activeUser, passwordHash });

      await expect(
        service.changePassword('user-1', 'CorrectPassword1!', 'CorrectPassword1!', '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('hashes and persists the new password, revokes every outstanding refresh token, and audits the change', async () => {
      const { service, prisma, auditService } = makeService();
      const passwordHash = await hashPassword('CorrectPassword1!');
      prisma.user.findUnique.mockResolvedValue({ ...activeUser, passwordHash });

      await service.changePassword('user-1', 'CorrectPassword1!', 'NewPassword456!', '127.0.0.1');

      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- test mock, loosely typed by design */
      const updateArgs = prisma.user.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: 'user-1' });
      expect(updateArgs.data.passwordHash).not.toBe('NewPassword456!');
      expect(updateArgs.data.passwordHash).not.toBe(passwordHash);
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as Date },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'user-1',
          action: AuditActions.PASSWORD_CHANGED,
        }),
      );
    });
  });

  describe('requestReset', () => {
    it('resolves silently for an unknown email — no user lookup leaks via the mailer/audit call', async () => {
      const { service, prisma, mailer, auditService } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.requestReset('nobody@test.com', '127.0.0.1')).resolves.toBeUndefined();
      expect(mailer.send).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('resolves silently for a non-ACTIVE account', async () => {
      const { service, prisma, mailer } = makeService();
      prisma.user.findUnique.mockResolvedValue({ ...activeUser, status: 'SUSPENDED' });

      await expect(service.requestReset(activeUser.email, '127.0.0.1')).resolves.toBeUndefined();
      expect(mailer.send).not.toHaveBeenCalled();
    });

    it('issues a token, sends it via the mailer, and audits the request for an active account', async () => {
      const { service, prisma, mailer, auditService } = makeService();
      prisma.user.findUnique.mockResolvedValue(activeUser);

      await service.requestReset(activeUser.email, '127.0.0.1');

      expect(prisma.passwordResetToken.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
      expect(mailer.send).toHaveBeenCalledWith(
        expect.objectContaining({ email: activeUser.email }),
      );
      // The raw token handed to the mailer is never the same value stored (only its hash is persisted).
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- test mock, loosely typed by design */
      const upsertArgs = prisma.passwordResetToken.upsert.mock.calls[0][0];
      const sentToken = mailer.send.mock.calls[0][0].token as string;
      expect(upsertArgs.create.tokenHash).not.toBe(sentToken);
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'user-1',
          action: AuditActions.PASSWORD_RESET_REQUESTED,
        }),
      );
    });
  });

  describe('reset', () => {
    it('rejects an unknown token', async () => {
      const { service, prisma } = makeService();
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(service.reset('bogus', 'NewPassword123!', '127.0.0.1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an already-used token', async () => {
      const { service, prisma } = makeService();
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        userId: 'user-1',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 100_000),
      });

      await expect(service.reset('used-token', 'NewPassword123!', '127.0.0.1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an expired token', async () => {
      const { service, prisma } = makeService();
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.reset('expired-token', 'NewPassword123!', '127.0.0.1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when the atomic single-use claim loses a race (already redeemed concurrently)', async () => {
      const { service } = makeService({
        prisma: {
          passwordResetToken: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'prt-1',
              userId: 'user-1',
              usedAt: null,
              expiresAt: new Date(Date.now() + 100_000),
            }),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
        },
      });

      await expect(service.reset('raced-token', 'NewPassword123!', '127.0.0.1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('claims the token, updates the password, revokes refresh tokens, and audits completion', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 100_000),
      });

      await service.reset('good-token', 'NewPassword123!', '127.0.0.1');

      expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'prt-1', usedAt: null },
        data: { usedAt: expect.any(Date) as Date },
      });
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- test mock, loosely typed by design */
      const updateArgs = prisma.user.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: 'user-1' });
      expect(updateArgs.data.passwordHash).not.toBe('NewPassword123!');
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as Date },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'user-1',
          action: AuditActions.PASSWORD_RESET_COMPLETED,
        }),
      );
    });
  });
});
