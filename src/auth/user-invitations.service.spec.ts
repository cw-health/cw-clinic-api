import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { UserInvitationsService } from './user-invitations.service';

function makeService(overrides?: Partial<Record<string, unknown>>) {
  const prisma = {
    user: {
      create: jest.fn().mockResolvedValue({ id: 'user-1' }),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    staffInvitation: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
  (prisma as Record<string, unknown>).$transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(prisma);
  });
  const service = new UserInvitationsService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('UserInvitationsService', () => {
  describe('createPendingUser', () => {
    it('creates a PENDING user with an unusable password hash and issues an invitation', async () => {
      const { service, prisma } = makeService();
      const { userId, invitation } = await service.createPendingUser(prisma as never, {
        email: 'nurse@clinic-a.test',
        firstName: 'N',
        lastName: 'U',
      });

      expect(userId).toBe('user-1');
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- test mock, loosely typed by design */
      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(createArgs.data.status).toBe('PENDING');
      expect(createArgs.data.isSuperAdmin).toBe(false);
      // Never a real/client-supplied password — a random 64-hex-char string, always hashed.
      expect(createArgs.data.passwordHash).not.toContain('undefined');
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
      expect(invitation.token).toEqual(expect.any(String));
      expect(invitation.token.length).toBeGreaterThanOrEqual(32);
    });
  });

  describe('resend', () => {
    it('rejects resending for a non-PENDING (already active) user', async () => {
      const { service } = makeService({
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', status: 'ACTIVE' }) },
      });
      await expect(service.resend('user-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects resending for a user that does not exist', async () => {
      const { service } = makeService({ user: { findUnique: jest.fn().mockResolvedValue(null) } });
      await expect(service.resend('missing')).rejects.toThrow(BadRequestException);
    });

    it('issues a fresh token for a PENDING user', async () => {
      const { service, prisma } = makeService({
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', status: 'PENDING' }) },
        staffInvitation: { upsert: jest.fn().mockResolvedValue({}) },
      });
      const invitation = await service.resend('user-1');
      expect(invitation.token).toEqual(expect.any(String));
      expect(prisma.staffInvitation.upsert).toHaveBeenCalled();
    });
  });

  describe('accept', () => {
    it('rejects an unknown token', async () => {
      const { service } = makeService({
        staffInvitation: { findUnique: jest.fn().mockResolvedValue(null) },
      });
      await expect(service.accept('bogus-token', 'NewPassword123!')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an already-accepted invitation', async () => {
      const { service } = makeService({
        staffInvitation: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'inv-1',
            userId: 'user-1',
            acceptedAt: new Date(),
            expiresAt: new Date(Date.now() + 100_000),
          }),
        },
      });
      await expect(service.accept('some-token', 'NewPassword123!')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an expired invitation', async () => {
      const { service } = makeService({
        staffInvitation: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'inv-1',
            userId: 'user-1',
            acceptedAt: null,
            expiresAt: new Date(Date.now() - 1000),
          }),
        },
      });
      await expect(service.accept('some-token', 'NewPassword123!')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('activates the account on a valid, unexpired, unaccepted token', async () => {
      const { service, prisma } = makeService({
        staffInvitation: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'inv-1',
            userId: 'user-1',
            acceptedAt: null,
            expiresAt: new Date(Date.now() + 100_000),
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      });
      const result = await service.accept('good-token', 'NewPassword123!');
      expect(result.userId).toBe('user-1');
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- test mock, loosely typed by design */
      const updateArgs = prisma.user.update.mock.calls[0][0];
      expect(updateArgs.data.status).toBe('ACTIVE');
      expect(updateArgs.data.passwordHash).not.toBe('NewPassword123!');
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
    });
  });
});
