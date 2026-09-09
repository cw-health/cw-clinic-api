import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { PlatformUsersService } from './platform-users.service';

jest.mock('../auth/password.util', () => ({
  hashPassword: jest.fn((plain: string) => Promise.resolve(`hashed:${plain}`)),
}));

function makeService(overrides?: Partial<Record<string, unknown>>) {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    ...overrides,
  };
  (prisma as Record<string, unknown>).$transaction = jest.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(prisma);
  });
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new PlatformUsersService(
    prisma as unknown as PrismaService,
    auditService as unknown as AuditService,
  );
  return { service, prisma, auditService };
}

describe('PlatformUsersService', () => {
  describe('listPlatformUsers', () => {
    it('scopes the query to isSuperAdmin: true and paginates', async () => {
      const { service, prisma } = makeService();
      prisma.user.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([{ id: 'user-a' }]);

      const result = await service.listPlatformUsers({
        page: 2,
        pageSize: 10,
        status: 'ACTIVE',
        search: 'jane',
      });

      expect(result).toEqual({
        data: [{ id: 'user-a' }],
        meta: { total: 1, page: 2, pageSize: 10 },
      });
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isSuperAdmin: true, status: 'ACTIVE' }),
          skip: 10,
          take: 10,
        }),
      );
      expect(prisma.user.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isSuperAdmin: true }) }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('never selects passwordHash', async () => {
      const { service, prisma } = makeService();
      prisma.user.count.mockResolvedValue(0);
      prisma.user.findMany.mockResolvedValue([]);

      await service.listPlatformUsers({});

      /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- test mock, loosely typed by design */
      const call = prisma.user.findMany.mock.calls[0][0];
      expect(call.select).not.toHaveProperty('passwordHash');
      expect(Object.keys(call.select)).not.toContain('passwordHash');
      /* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
    });
  });

  describe('getPlatformUserById', () => {
    it('404s when no platform user with that id exists', async () => {
      const { service, prisma } = makeService();
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.getPlatformUserById('user-a')).rejects.toThrow(NotFoundException);
    });

    it('scopes the lookup to isSuperAdmin: true (a tenant user is not found)', async () => {
      const { service, prisma } = makeService();
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.getPlatformUserById('tenant-user')).rejects.toThrow(NotFoundException);
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'tenant-user', isSuperAdmin: true } }),
      );
    });
  });

  describe('createPlatformUser', () => {
    it('rejects a duplicate email', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(
        service.createPlatformUser(
          { firstName: 'A', lastName: 'B', email: 'a@b.com', password: 'supersecretpassword' },
          'admin-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('creates the user with isSuperAdmin: true and records a platform-actor audit event', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'user-new', email: 'a@b.com' });

      const user = await service.createPlatformUser(
        { firstName: 'A', lastName: 'B', email: 'a@b.com', password: 'supersecretpassword' },
        'admin-1',
      );

      expect(user).toEqual({ id: 'user-new', email: 'a@b.com' });
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- test mock, loosely typed by design */
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isSuperAdmin: true,
            status: 'ACTIVE',
            passwordHash: 'hashed:supersecretpassword',
          }),
        }),
      );
      // Never store the plaintext password
      expect(prisma.user.create.mock.calls[0][0].data.password).toBeUndefined();
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: null,
          actorUserId: 'admin-1',
          actorType: 'PLATFORM_USER',
          entity: 'User',
          entityId: 'user-new',
          action: 'CREATE',
        }),
      );
    });
  });

  describe('updatePlatformUser', () => {
    it('404s when the platform user does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(
        service.updatePlatformUser('user-a', { firstName: 'New' }, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects changing email to one already in use by another user', async () => {
      const { service, prisma } = makeService();
      prisma.user.findFirst.mockResolvedValue({ id: 'user-a' });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-b' });
      await expect(
        service.updatePlatformUser('user-a', { email: 'taken@b.com' }, 'admin-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('updates and records an audit event', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.user.findFirst.mockResolvedValue({ id: 'user-a' });
      prisma.user.update.mockResolvedValue({ id: 'user-a', firstName: 'New' });

      await service.updatePlatformUser('user-a', { firstName: 'New' }, 'admin-1');

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', actorType: 'PLATFORM_USER', clinicId: null }),
      );
    });
  });

  describe('activatePlatformUser', () => {
    it('sets status ACTIVE and records an audit event', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.user.findFirst.mockResolvedValue({ id: 'user-a' });
      prisma.user.update.mockResolvedValue({ id: 'user-a', status: 'ACTIVE' });

      await service.activatePlatformUser('user-a', 'admin-1');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-a' }, data: { status: 'ACTIVE' } }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ACTIVATE', actorType: 'PLATFORM_USER' }),
      );
    });
  });

  describe('deactivatePlatformUser (self-protection)', () => {
    it('prevents a Super Admin from deactivating their own account', async () => {
      const { service } = makeService();
      await expect(service.deactivatePlatformUser('admin-1', 'admin-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('404s when the platform user does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.deactivatePlatformUser('user-b', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('prevents deactivating the last active Super Admin', async () => {
      const { service, prisma } = makeService();
      prisma.user.findFirst.mockResolvedValue({ id: 'user-b' });
      prisma.user.count.mockResolvedValue(0);

      await expect(service.deactivatePlatformUser('user-b', 'admin-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.user.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isSuperAdmin: true, status: 'ACTIVE', id: { not: 'user-b' } },
        }),
      );
    });

    it('deactivates and records an audit event when another active Super Admin remains', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.user.findFirst.mockResolvedValue({ id: 'user-b' });
      prisma.user.count.mockResolvedValue(1);
      prisma.user.update.mockResolvedValue({ id: 'user-b', status: 'INACTIVE' });

      await service.deactivatePlatformUser('user-b', 'admin-1');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-b' }, data: { status: 'INACTIVE' } }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEACTIVATE',
          actorType: 'PLATFORM_USER',
          clinicId: null,
        }),
      );
    });
  });
});
