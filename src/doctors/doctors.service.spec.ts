import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { DoctorsService } from './doctors.service';

const doctorRole = { id: 'role-doctor', name: 'Doctor' };

const doctorRow = {
  id: 'doctor-1',
  clinicId: 'clinic-a',
  userId: 'user-1',
  phone: null,
  licenseNumber: null,
  qualification: null,
  bio: null,
  consultationFee: null,
  yearsOfExperience: null,
  status: 'ACTIVE',
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  user: {
    id: 'user-1',
    email: 'doc@clinic-a.test',
    firstName: 'Ada',
    lastName: 'Lovelace',
  },
  specializations: [],
  departments: [],
};

function makeService(overrides?: Partial<Record<string, unknown>>) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    role: { findFirst: jest.fn().mockResolvedValue(doctorRole) },
    clinicMembership: { create: jest.fn().mockResolvedValue({}) },
    specialization: { count: jest.fn().mockResolvedValue(0) },
    department: { count: jest.fn().mockResolvedValue(0) },
    doctorDepartment: { deleteMany: jest.fn(), createMany: jest.fn() },
    doctor: {
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    doctorSpecialization: { deleteMany: jest.fn(), createMany: jest.fn() },
    doctorAvailability: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    ...overrides,
  };
  // findFirstOrThrow always mirrors findFirst's current mock behaviour —
  // update()/updateOwn()/updateStatus() re-fetch with it after a scoped
  // updateMany() write (see scoped-write.util.ts).
  prisma.doctor.findFirstOrThrow.mockImplementation((args: unknown): unknown =>
    prisma.doctor.findFirst(args),
  );
  (prisma as Record<string, unknown>).$transaction = jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: unknown) => unknown)(prisma);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new DoctorsService(
    prisma as unknown as PrismaService,
    auditService as unknown as AuditService,
  );
  return { service, prisma, auditService };
}

describe('DoctorsService', () => {
  describe('create', () => {
    it('rejects a duplicate email', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create(
          'clinic-a',
          {
            email: 'dup@test.com',
            firstName: 'A',
            lastName: 'B',
            temporaryPassword: 'Password123!',
          },
          'staff-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects an unknown specializationId', async () => {
      const { service, prisma } = makeService();
      prisma.specialization.count.mockResolvedValue(0);

      await expect(
        service.create(
          'clinic-a',
          {
            email: 'new@test.com',
            firstName: 'A',
            lastName: 'B',
            temporaryPassword: 'Password123!',
            specializationIds: ['11111111-1111-4111-8111-111111111111'],
          },
          'staff-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates the User, ClinicMembership, and Doctor scoped to the caller clinic', async () => {
      const { service, prisma } = makeService();
      prisma.user.create.mockResolvedValue({ id: 'new-user' });
      prisma.doctor.create.mockResolvedValue(doctorRow);

      await service.create(
        'clinic-a',
        {
          email: 'new@test.com',
          firstName: 'A',
          lastName: 'B',
          temporaryPassword: 'Password123!',
        },
        'staff-1',
      );

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.clinicMembership.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ clinicId: 'clinic-a', roleId: 'role-doctor' }),
        }),
      );
      expect(prisma.doctor.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ clinicId: 'clinic-a' }) }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });
  });

  describe('findById (tenant isolation)', () => {
    it('scopes the lookup by clinicId and 404s when not found in this clinic', async () => {
      const { service, prisma } = makeService();
      prisma.doctor.findFirst.mockResolvedValue(null);

      await expect(service.findById('clinic-a', 'doctor-1')).rejects.toThrow(NotFoundException);

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.doctor.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'doctor-1', clinicId: 'clinic-a' }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('a doctor belonging to another clinic is not returned even by id', async () => {
      const { service, prisma } = makeService();
      // Simulates the DB correctly filtering — a cross-tenant row never
      // matches the where clause, so the fake returns null exactly like a
      // real findFirst({ where: { id, clinicId } }) would for a foreign row.
      prisma.doctor.findFirst.mockResolvedValue(null);

      await expect(service.findById('clinic-b', 'doctor-1')).rejects.toThrow(NotFoundException);
    });

    it('returns the doctor when it belongs to the caller clinic', async () => {
      const { service, prisma } = makeService();
      prisma.doctor.findFirst.mockResolvedValue(doctorRow);

      const result = await service.findById('clinic-a', 'doctor-1');
      expect(result.id).toBe('doctor-1');
      expect(result.email).toBe('doc@clinic-a.test');
    });
  });

  describe('findAll pagination/search', () => {
    it('applies clinicId, pagination, and search to the query', async () => {
      const { service, prisma } = makeService();
      prisma.doctor.count.mockResolvedValue(42);
      prisma.doctor.findMany.mockResolvedValue([doctorRow]);

      const result = await service.findAll('clinic-a', {
        page: 2,
        pageSize: 10,
        search: 'lovelace',
      });

      expect(result.meta).toEqual({ total: 42, page: 2, pageSize: 10 });
      expect(result.data).toHaveLength(1);

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.doctor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ clinicId: 'clinic-a' }),
          skip: 10,
          take: 10,
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('a multi-word search ("Ada Lovelace") requires each word to match, not the whole phrase against one column', async () => {
      const { service, prisma } = makeService();
      prisma.doctor.count.mockResolvedValue(1);
      prisma.doctor.findMany.mockResolvedValue([doctorRow]);

      await service.findAll('clinic-a', { page: 1, pageSize: 20, search: 'Ada Lovelace' });

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.doctor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user: {
              AND: [
                {
                  OR: [
                    { firstName: { contains: 'Ada' } },
                    { lastName: { contains: 'Ada' } },
                    { email: { contains: 'Ada' } },
                  ],
                },
                {
                  OR: [
                    { firstName: { contains: 'Lovelace' } },
                    { lastName: { contains: 'Lovelace' } },
                    { email: { contains: 'Lovelace' } },
                  ],
                },
              ],
            },
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });
  });

  describe('setAvailability validation', () => {
    it('rejects a duplicate dayOfWeek', async () => {
      const { service, prisma } = makeService();
      prisma.doctor.findFirst.mockResolvedValue(doctorRow);

      await expect(
        service.setAvailability('clinic-a', 'doctor-1', {
          days: [
            { dayOfWeek: 1, isActive: true, startTime: '09:00', endTime: '17:00' },
            { dayOfWeek: 1, isActive: true, startTime: '09:00', endTime: '17:00' },
          ],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects startTime >= endTime', async () => {
      const { service, prisma } = makeService();
      prisma.doctor.findFirst.mockResolvedValue(doctorRow);

      await expect(
        service.setAvailability('clinic-a', 'doctor-1', {
          days: [{ dayOfWeek: 1, isActive: true, startTime: '17:00', endTime: '09:00' }],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('404s for a doctor outside the caller clinic', async () => {
      const { service, prisma } = makeService();
      prisma.doctor.findFirst.mockResolvedValue(null);

      await expect(
        service.setAvailability('clinic-b', 'doctor-1', {
          days: [{ dayOfWeek: 1, isActive: true, startTime: '09:00', endTime: '17:00' }],
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('audit trail (Phase 1F)', () => {
    it('records DOCTOR_CREATED, DOCTOR_VIEWED (audited read only), and DOCTOR_DEACTIVATED', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.user.create.mockResolvedValue({ id: 'new-user' });
      prisma.doctor.create.mockResolvedValue(doctorRow);
      prisma.doctor.findFirst.mockResolvedValue(doctorRow);
      prisma.doctor.update.mockResolvedValue({ ...doctorRow, status: 'INACTIVE' });

      await service.create(
        'clinic-a',
        { email: 'new@test.com', firstName: 'A', lastName: 'B', temporaryPassword: 'Password123!' },
        'staff-1',
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'Doctor',
          action: 'doctor.created',
          actorUserId: 'staff-1',
        }),
      );

      await service.findById('clinic-a', 'doctor-1');
      expect(auditService.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'doctor.viewed' }),
      );
      await service.findByIdAudited('clinic-a', 'doctor-1', 'staff-1');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'Doctor',
          action: 'doctor.viewed',
          actorUserId: 'staff-1',
        }),
      );

      await service.updateStatus('clinic-a', 'doctor-1', 'INACTIVE', 'staff-1');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'Doctor',
          action: 'doctor.deactivated',
          changedFields: 'status=INACTIVE',
        }),
      );
    });

    it('records DOCTOR_ACTIVATED when reactivating a doctor', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.doctor.findFirst.mockResolvedValue({ ...doctorRow, status: 'INACTIVE' });
      prisma.doctor.update.mockResolvedValue(doctorRow);

      await service.updateStatus('clinic-a', 'doctor-1', 'ACTIVE', 'staff-1');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'Doctor',
          action: 'doctor.activated',
          changedFields: 'status=ACTIVE',
        }),
      );
    });
  });

  describe('department assignment', () => {
    it('rejects an unknown departmentId', async () => {
      const { service, prisma } = makeService();
      prisma.department.count.mockResolvedValue(0);

      await expect(
        service.create(
          'clinic-a',
          {
            email: 'new@test.com',
            firstName: 'A',
            lastName: 'B',
            temporaryPassword: 'Password123!',
            departmentIds: ['11111111-1111-4111-8111-111111111111'],
          },
          'staff-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('replaces DoctorDepartment rows on update when departmentIds is given', async () => {
      const { service, prisma } = makeService();
      prisma.doctor.findFirst.mockResolvedValue(doctorRow);
      prisma.department.count.mockResolvedValue(1);

      await service.update(
        'clinic-a',
        'doctor-1',
        { departmentIds: ['22222222-2222-4222-8222-222222222222'] },
        'staff-1',
      );

      expect(prisma.doctorDepartment.deleteMany).toHaveBeenCalledWith({
        where: { doctorId: 'doctor-1' },
      });
      expect(prisma.doctorDepartment.createMany).toHaveBeenCalledWith({
        data: [{ doctorId: 'doctor-1', departmentId: '22222222-2222-4222-8222-222222222222' }],
      });
    });

    it('maps included departments/branches onto the response DTO', async () => {
      const { service, prisma } = makeService();
      prisma.doctor.findFirst.mockResolvedValue({
        ...doctorRow,
        departments: [
          {
            department: {
              id: 'dept-1',
              name: 'Cardiology',
              code: 'CARD',
              branch: { id: 'branch-1', name: 'Main', code: 'MAIN' },
            },
          },
        ],
      });

      const result = await service.findById('clinic-a', 'doctor-1');
      expect(result.departments).toEqual([
        {
          id: 'dept-1',
          name: 'Cardiology',
          code: 'CARD',
          branchId: 'branch-1',
          branchName: 'Main',
          branchCode: 'MAIN',
        },
      ]);
      expect(result.branches).toEqual([{ id: 'branch-1', name: 'Main', code: 'MAIN' }]);
    });
  });

  describe('countActive / countActiveGroupedByClinic (SA-09)', () => {
    it('counts only ACTIVE, non-deleted doctors for one clinic', async () => {
      const { service, prisma } = makeService();
      prisma.doctor.count.mockResolvedValue(4);

      const result = await service.countActive('clinic-a');

      expect(result).toBe(4);
      expect(prisma.doctor.count).toHaveBeenCalledWith({
        where: { clinicId: 'clinic-a', status: 'ACTIVE', deletedAt: null },
      });
    });

    it('returns an empty map without querying when given no clinic ids', async () => {
      const { service, prisma } = makeService();

      const result = await service.countActiveGroupedByClinic([]);

      expect(result.size).toBe(0);
      expect(prisma.doctor.groupBy).not.toHaveBeenCalled();
    });

    it('groups counts by clinic in a single aggregate query', async () => {
      const { service, prisma } = makeService();
      prisma.doctor.groupBy.mockResolvedValue([
        { clinicId: 'clinic-a', _count: { _all: 3 } },
        { clinicId: 'clinic-b', _count: { _all: 1 } },
      ]);

      const result = await service.countActiveGroupedByClinic(['clinic-a', 'clinic-b']);

      expect(result.get('clinic-a')).toBe(3);
      expect(result.get('clinic-b')).toBe(1);
      expect(result.get('clinic-c')).toBeUndefined();
    });
  });
});
