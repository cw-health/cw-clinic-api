import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { RolesService } from './roles.service';

const CLINIC_A = 'clinic-a';
const CLINIC_B = 'clinic-b';

const customRole = {
  id: 'role-custom-1',
  clinicId: CLINIC_A,
  name: 'Front Office Lead',
  description: 'Custom role',
  isSystem: false,
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const systemRole = {
  id: 'role-doctor',
  clinicId: null,
  name: 'Doctor',
  description: 'Clinician',
  isSystem: true,
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const superAdminRole = {
  id: 'role-super-admin',
  clinicId: null,
  name: 'SuperAdmin',
  description: 'Platform admin',
  isSystem: true,
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeService(overrides?: Partial<Record<string, unknown>>) {
  const prisma = {
    role: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
    },
    permission: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    rolePermission: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    clinicMembership: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
  (prisma as Record<string, unknown>).$transaction = jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: unknown) => unknown)(prisma);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });

  const auditService = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new RolesService(
    prisma as unknown as PrismaService,
    auditService as unknown as AuditService,
  );
  return { service, prisma, auditService };
}

describe('RolesService', () => {
  describe('getPermissionCatalog', () => {
    it('never returns a platform-only category (clinics/super-admin)', async () => {
      const { service, prisma } = makeService();
      await service.getPermissionCatalog();

      expect(prisma.permission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { category: { notIn: ['clinics', 'super-admin'] } },
        }),
      );
    });

    it('groups permissions by category with a human-facing module label', async () => {
      const { service, prisma } = makeService({
        permission: {
          findMany: jest.fn().mockResolvedValue([
            { key: 'patients:read', description: 'View patients', category: 'patients' },
            { key: 'patients:create', description: 'Create patients', category: 'patients' },
            { key: 'medicines:read', description: 'Search formulary', category: 'medicines' },
          ]),
        },
      });
      void prisma;

      const catalog = await service.getPermissionCatalog();

      expect(catalog).toEqual([
        {
          category: 'patients',
          label: 'Patients',
          permissions: [
            { key: 'patients:read', description: 'View patients', category: 'patients' },
            { key: 'patients:create', description: 'Create patients', category: 'patients' },
          ],
        },
        {
          category: 'medicines',
          label: 'Pharmacy',
          permissions: [
            { key: 'medicines:read', description: 'Search formulary', category: 'medicines' },
          ],
        },
      ]);
    });
  });

  describe('create', () => {
    it('rejects an unknown permission key', async () => {
      const { service } = makeService();

      await expect(
        service.create(CLINIC_A, 'user-1', {
          name: 'New Role',
          permissionKeys: ['patients:teleport'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a platform-only permission key (privilege-escalation guard)', async () => {
      const { service, prisma } = makeService({
        permission: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              { key: 'super-admin:dashboard-read', description: 'x', category: 'super-admin' },
            ]),
        },
      });
      void prisma;

      await expect(
        service.create(CLINIC_A, 'user-1', {
          name: 'Shadow Admin',
          permissionKeys: ['super-admin:dashboard-read'],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a clinics:* permission key the same way', async () => {
      const { service } = makeService({
        permission: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ key: 'clinics:suspend', description: 'x', category: 'clinics' }]),
        },
      });

      await expect(
        service.create(CLINIC_A, 'user-1', { name: 'Rogue', permissionKeys: ['clinics:suspend'] }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a duplicate role name within the clinic', async () => {
      const { service, prisma } = makeService();
      prisma.role.findFirst.mockResolvedValueOnce(customRole); // name clash

      await expect(
        service.create(CLINIC_A, 'user-1', {
          name: customRole.name,
          permissionKeys: ['patients:read'],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a name that shadows a system template', async () => {
      const { service, prisma } = makeService();
      prisma.role.findFirst.mockResolvedValueOnce(systemRole); // name clash against system template

      await expect(
        service.create(CLINIC_A, 'user-1', { name: 'Doctor', permissionKeys: ['patients:read'] }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates a custom role scoped to the caller clinic, never isSystem', async () => {
      const { service, prisma } = makeService({
        permission: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([
              { id: 'perm-1', key: 'patients:read', description: 'x', category: 'patients' },
            ])
            .mockResolvedValueOnce([
              { id: 'perm-1', key: 'patients:read', description: 'x', category: 'patients' },
            ]),
        },
        role: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(null) // name-availability check
            .mockResolvedValueOnce({ ...customRole, _count: { rolePermissions: 1 } }), // findById re-read
          findUnique: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn((_data: Record<string, unknown>) => Promise.resolve(customRole)),
          update: jest.fn(),
        },
      });

      await service.create(CLINIC_A, 'user-1', {
        name: 'Front Office Lead',
        permissionKeys: ['patients:read'],
      });

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.role.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ clinicId: CLINIC_A, isSystem: false, status: 'ACTIVE' }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });
  });

  describe('update', () => {
    it('rejects modifying a system role template', async () => {
      const { service, prisma } = makeService();
      prisma.role.findFirst.mockResolvedValueOnce(null); // not this clinic's own row
      prisma.role.findFirst.mockResolvedValueOnce(systemRole); // it is a system template

      await expect(
        service.update(CLINIC_A, systemRole.id, 'user-1', { description: 'hijacked' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects modifying an archived custom role', async () => {
      const { service, prisma } = makeService();
      prisma.role.findFirst.mockResolvedValueOnce({ ...customRole, status: 'INACTIVE' });

      await expect(
        service.update(CLINIC_A, customRole.id, 'user-1', { description: 'x' }),
      ).rejects.toThrow(ConflictException);
    });

    it("rejects modifying another clinic's custom role", async () => {
      const { service, prisma } = makeService();
      prisma.role.findFirst.mockResolvedValueOnce(null); // not clinic B's own row
      prisma.role.findFirst.mockResolvedValueOnce(null); // not a system template either

      await expect(
        service.update(CLINIC_B, customRole.id, 'user-1', { description: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects granting a platform-only permission on update', async () => {
      const { service, prisma } = makeService({
        role: {
          findFirst: jest.fn().mockResolvedValueOnce(customRole),
          findUnique: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn(),
          update: jest.fn(),
        },
        permission: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([
              { key: 'clinics:read', description: 'x', category: 'clinics' },
            ]),
        },
      });
      void prisma;

      await expect(
        service.update(CLINIC_A, customRole.id, 'user-1', { permissionKeys: ['clinics:read'] }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('archive', () => {
    it('archives directly when no staff hold the role', async () => {
      const { service, prisma } = makeService({
        role: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(customRole) // findOwnCustomRoleOrThrow
            .mockResolvedValueOnce({
              ...customRole,
              status: 'INACTIVE',
              _count: { rolePermissions: 0 },
            }), // findById re-read
          findUnique: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn(),
          update: jest.fn(),
        },
        clinicMembership: {
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
          updateMany: jest.fn(),
          groupBy: jest.fn().mockResolvedValue([]),
        },
      });

      await service.archive(CLINIC_A, customRole.id, 'user-1', {});

      expect(prisma.role.update).toHaveBeenCalledWith({
        where: { id: customRole.id },
        data: { status: 'INACTIVE' },
      });
    });

    it('blocks archiving an actively-assigned role without a reassignment target', async () => {
      const { service, prisma } = makeService({
        role: { findFirst: jest.fn().mockResolvedValueOnce(customRole) },
        clinicMembership: { count: jest.fn().mockResolvedValue(3) },
      });
      void prisma;

      await expect(service.archive(CLINIC_A, customRole.id, 'user-1', {})).rejects.toThrow(
        ConflictException,
      );
    });

    it('reassigns active staff to the target role, then archives, in one transaction', async () => {
      const targetRole = { ...systemRole, id: 'role-frontdesk', name: 'FrontDesk' };
      const { service, prisma } = makeService({
        role: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(customRole) // findOwnCustomRoleOrThrow
            .mockResolvedValueOnce({
              ...customRole,
              status: 'INACTIVE',
              _count: { rolePermissions: 0 },
            }), // findById re-read
          findUnique: jest.fn().mockResolvedValue(targetRole), // assertAssignableRole
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn(),
          update: jest.fn(),
        },
        clinicMembership: {
          count: jest.fn().mockResolvedValue(2),
          findMany: jest.fn().mockResolvedValue([]),
          updateMany: jest.fn(),
          groupBy: jest.fn().mockResolvedValue([]),
        },
      });

      await service.archive(CLINIC_A, customRole.id, 'user-1', { reassignToRoleId: targetRole.id });

      expect(prisma.clinicMembership.updateMany).toHaveBeenCalledWith({
        where: { clinicId: CLINIC_A, roleId: customRole.id, status: 'ACTIVE' },
        data: { roleId: targetRole.id },
      });
      expect(prisma.role.update).toHaveBeenCalledWith({
        where: { id: customRole.id },
        data: { status: 'INACTIVE' },
      });
    });

    it('rejects reassigning to the SuperAdmin role', async () => {
      const { service, prisma } = makeService({
        role: {
          findFirst: jest.fn().mockResolvedValueOnce(customRole),
          findUnique: jest.fn().mockResolvedValue(superAdminRole),
        },
        clinicMembership: { count: jest.fn().mockResolvedValue(1) },
      });
      void prisma;

      await expect(
        service.archive(CLINIC_A, customRole.id, 'user-1', { reassignToRoleId: superAdminRole.id }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects reassigning to a role that belongs to a different clinic', async () => {
      const otherClinicRole = { ...customRole, id: 'role-other-clinic', clinicId: CLINIC_B };
      const { service, prisma } = makeService({
        role: {
          findFirst: jest.fn().mockResolvedValueOnce(customRole),
          findUnique: jest.fn().mockResolvedValue(otherClinicRole),
        },
        clinicMembership: { count: jest.fn().mockResolvedValue(1) },
      });
      void prisma;

      await expect(
        service.archive(CLINIC_A, customRole.id, 'user-1', {
          reassignToRoleId: otherClinicRole.id,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll / findById — visibility', () => {
    it("never surfaces another clinic's custom role", async () => {
      const { service, prisma } = makeService();
      prisma.role.findFirst.mockResolvedValueOnce(null);

      await expect(service.findById(CLINIC_B, customRole.id)).rejects.toThrow(NotFoundException);
    });

    it('excludes SuperAdmin/Patient from the system-template visibility filter', async () => {
      const { service, prisma } = makeService();
      await service.findAll(CLINIC_A, {});

      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- test mock, loosely typed by design */
      const whereArg = prisma.role.count.mock.calls[0][0].where;
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
      expect(JSON.stringify(whereArg)).toContain('SuperAdmin');
      expect(JSON.stringify(whereArg)).toContain('Patient');
    });
  });
});
