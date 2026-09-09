import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { UserInvitationsService } from '../auth/user-invitations.service';
import type { PrismaService } from '../prisma/prisma.service';
import { StaffService } from './staff.service';

const CLINIC_A = 'clinic-a';
const CLINIC_B = 'clinic-b';

const clinicAdminRole = {
  id: 'role-clinicadmin',
  clinicId: null,
  isSystem: true,
  name: 'ClinicAdmin',
  status: 'ACTIVE',
};
const nurseRole = {
  id: 'role-nurse',
  clinicId: null,
  isSystem: true,
  name: 'Nurse',
  status: 'ACTIVE',
};
const superAdminRole = {
  id: 'role-superadmin',
  clinicId: null,
  isSystem: true,
  name: 'SuperAdmin',
  status: 'ACTIVE',
};
const patientRole = {
  id: 'role-patient',
  clinicId: null,
  isSystem: true,
  name: 'Patient',
  status: 'ACTIVE',
};
const clinicBCustomRole = {
  id: 'role-custom-b',
  clinicId: CLINIC_B,
  isSystem: false,
  name: 'CustomB',
  status: 'ACTIVE',
};

const membershipRow = {
  id: 'membership-1',
  userId: 'user-1',
  clinicId: CLINIC_A,
  roleId: nurseRole.id,
  branchId: null,
  departmentId: null,
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
  user: {
    id: 'user-1',
    email: 'nurse@clinic-a.test',
    firstName: 'Nancy',
    lastName: 'Nurse',
    status: 'PENDING',
    staffInvitation: { acceptedAt: null },
  },
  role: nurseRole,
  branch: null,
  department: null,
};

function makeService(overrides?: {
  prisma?: Partial<Record<string, unknown>>;
  userInvitations?: Partial<Record<string, unknown>>;
}) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    role: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    branch: { findFirst: jest.fn() },
    department: { findFirst: jest.fn() },
    clinicMembership: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(membershipRow),
      update: jest.fn().mockResolvedValue(membershipRow),
    },
    refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    staffInvitation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    ...overrides?.prisma,
  };
  (prisma as Record<string, unknown>).$transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(prisma);
  });

  const userInvitations = {
    createPendingUser: jest.fn().mockResolvedValue({
      userId: 'user-1',
      invitation: { token: 'raw-token', expiresAt: new Date() },
    }),
    resend: jest.fn().mockResolvedValue({ token: 'raw-token-2', expiresAt: new Date() }),
    ...overrides?.userInvitations,
  };

  const auditService = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new StaffService(
    prisma as unknown as PrismaService,
    userInvitations as unknown as UserInvitationsService,
    auditService as unknown as AuditService,
  );

  return { service, prisma, userInvitations, auditService };
}

describe('StaffService', () => {
  describe('invite', () => {
    it('rejects a duplicate email (409)', async () => {
      const { service, prisma } = makeService({
        prisma: { user: { findUnique: jest.fn().mockResolvedValue({ id: 'existing' }) } },
      });
      await expect(
        service.invite(
          CLINIC_A,
          { email: 'dupe@test.com', firstName: 'A', lastName: 'B', roleId: nurseRole.id },
          'actor-1',
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.clinicMembership.findFirst).not.toHaveBeenCalled();
    });

    it('rejects assigning the SuperAdmin role (403) — cannot create Super Admin accounts', async () => {
      const { service } = makeService({
        prisma: { role: { findUnique: jest.fn().mockResolvedValue(superAdminRole) } },
      });
      await expect(
        service.invite(
          CLINIC_A,
          { email: 'x@test.com', firstName: 'A', lastName: 'B', roleId: superAdminRole.id },
          'actor-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects assigning the Patient role (400) — staff is never a Patient', async () => {
      const { service } = makeService({
        prisma: { role: { findUnique: jest.fn().mockResolvedValue(patientRole) } },
      });
      await expect(
        service.invite(
          CLINIC_A,
          { email: 'x@test.com', firstName: 'A', lastName: 'B', roleId: patientRole.id },
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects assigning another clinic's custom role (400, not leaked as 404)", async () => {
      const { service } = makeService({
        prisma: { role: { findUnique: jest.fn().mockResolvedValue(clinicBCustomRole) } },
      });
      await expect(
        service.invite(
          CLINIC_A,
          { email: 'x@test.com', firstName: 'A', lastName: 'B', roleId: clinicBCustomRole.id },
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects a branchId that does not belong to the caller's clinic (400)", async () => {
      const { service } = makeService({
        prisma: {
          role: { findUnique: jest.fn().mockResolvedValue(clinicAdminRole) },
          branch: { findFirst: jest.fn().mockResolvedValue(null) },
        },
      });
      await expect(
        service.invite(
          CLINIC_A,
          {
            email: 'x@test.com',
            firstName: 'A',
            lastName: 'B',
            roleId: clinicAdminRole.id,
            branchId: 'foreign-branch',
          },
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a pending user + membership and returns a one-time invite token', async () => {
      const { service, userInvitations, auditService } = makeService({
        prisma: { role: { findUnique: jest.fn().mockResolvedValue(clinicAdminRole) } },
      });
      const result = await service.invite(
        CLINIC_A,
        {
          email: 'newadmin@clinic-a.test',
          firstName: 'New',
          lastName: 'Admin',
          roleId: clinicAdminRole.id,
        },
        'actor-1',
      );

      expect(userInvitations.createPendingUser).toHaveBeenCalled();
      expect(result.invite.token).toBe('raw-token');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ clinicId: CLINIC_A, action: 'INVITE' }),
      );
    });
  });

  describe('assignRole', () => {
    it('rejects re-assigning to SuperAdmin on an existing staff member too', async () => {
      const { service } = makeService({
        prisma: {
          clinicMembership: {
            findFirst: jest.fn().mockResolvedValue(membershipRow),
            update: jest.fn().mockResolvedValue(membershipRow),
          },
          role: { findUnique: jest.fn().mockResolvedValue(superAdminRole) },
        },
      });
      await expect(
        service.assignRole(CLINIC_A, 'membership-1', superAdminRole.id, 'actor-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('tenant isolation', () => {
    it('404s for a membership id that belongs to another clinic', async () => {
      const { service } = makeService({
        prisma: { clinicMembership: { findFirst: jest.fn().mockResolvedValue(null) } },
      });
      await expect(service.findById(CLINIC_B, 'membership-1')).rejects.toThrow(
        'Staff member not found',
      );
    });
  });

  describe('self-protection', () => {
    it('rejects deactivating your own staff access', async () => {
      const { service } = makeService({
        prisma: { clinicMembership: { findFirst: jest.fn().mockResolvedValue(membershipRow) } },
      });
      await expect(
        service.updateStatus(CLINIC_A, 'membership-1', 'INACTIVE', membershipRow.userId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects revoking your own access', async () => {
      const { service } = makeService({
        prisma: { clinicMembership: { findFirst: jest.fn().mockResolvedValue(membershipRow) } },
      });
      await expect(
        service.revokeAccess(CLINIC_A, 'membership-1', membershipRow.userId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('revokeAccess', () => {
    it('deactivates the membership and revokes outstanding refresh tokens', async () => {
      const { service, prisma } = makeService({
        prisma: {
          clinicMembership: {
            findFirst: jest.fn().mockResolvedValue(membershipRow),
            update: jest.fn().mockResolvedValue(membershipRow),
          },
        },
      });
      await service.revokeAccess(CLINIC_A, 'membership-1', 'some-other-admin');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: membershipRow.userId, revokedAt: null },
        data: { revokedAt: expect.any(Date) as Date },
      });
    });
  });

  describe('listAssignableRoles', () => {
    it('never includes SuperAdmin/Patient in the query filter used', async () => {
      const { service, prisma } = makeService();
      await service.listAssignableRoles(CLINIC_A);
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- test mock, loosely typed by design */
      const call = prisma.role.findMany.mock.calls[0][0];
      expect(call.where.OR[0].name.notIn).toEqual(
        expect.arrayContaining(['SuperAdmin', 'Patient']),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
    });
  });
});
