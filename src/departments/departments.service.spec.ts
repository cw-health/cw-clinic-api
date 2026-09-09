import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { DepartmentsService } from './departments.service';

const branchRow = {
  id: 'branch-1',
  clinicId: 'clinic-a',
  name: 'Main Branch',
  code: 'MAIN',
  status: 'ACTIVE',
  deletedAt: null,
};

const departmentRow = {
  id: 'dept-1',
  clinicId: 'clinic-a',
  branchId: 'branch-1',
  name: 'Cardiology',
  code: 'CARDIO',
  description: null,
  status: 'ACTIVE',
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  branch: { id: 'branch-1', name: 'Main Branch', code: 'MAIN' },
  doctors: [],
};

function makeService(overrides?: Partial<Record<string, unknown>>) {
  const prisma = {
    branch: { findFirst: jest.fn().mockResolvedValue(branchRow) },
    doctor: { count: jest.fn().mockResolvedValue(0) },
    department: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
    },
    doctorDepartment: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    ...overrides,
  };
  (prisma as Record<string, unknown>).$transaction = jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: unknown) => unknown)(prisma);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
  const service = new DepartmentsService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('DepartmentsService', () => {
  describe('create — branch ownership', () => {
    it('rejects a branchId that does not belong to the caller clinic', async () => {
      const { service, prisma } = makeService();
      prisma.branch.findFirst.mockResolvedValue(null); // branch not found for this clinic

      await expect(
        service.create('clinic-a', { branchId: 'branch-x', name: 'OPD', code: 'OPD' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a branch belonging to a different clinic (tenant isolation)', async () => {
      const { service, prisma } = makeService();
      // Simulates the DB correctly filtering — a cross-tenant branch row
      // never matches the where clause (id + clinicId), same as real Prisma.
      prisma.branch.findFirst.mockResolvedValue(null);

      await expect(
        service.create('clinic-b', { branchId: 'branch-1', name: 'OPD', code: 'OPD' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('create — duplicate names/codes', () => {
    it('rejects a duplicate code within the same branch', async () => {
      const { service, prisma } = makeService();
      prisma.department.findFirst.mockResolvedValueOnce(departmentRow); // code check hits

      await expect(
        service.create('clinic-a', { branchId: 'branch-1', name: 'Second Dept', code: 'CARDIO' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a duplicate name within the same branch', async () => {
      const { service, prisma } = makeService();
      prisma.department.findFirst
        .mockResolvedValueOnce(null) // code check passes
        .mockResolvedValueOnce(departmentRow); // name check hits

      await expect(
        service.create('clinic-a', { branchId: 'branch-1', name: 'Cardiology', code: 'CARD2' }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows the same code/name to be reused across different branches', async () => {
      const { service, prisma } = makeService();
      prisma.department.create.mockResolvedValue(departmentRow);

      await service.create('clinic-a', {
        branchId: 'branch-1',
        name: 'Cardiology',
        code: 'CARDIO',
      });

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.department.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ branchId: 'branch-1' }) }),
      );
      expect(prisma.department.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ clinicId: 'clinic-a', branchId: 'branch-1' }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });
  });

  describe('create — existing doctor compatibility', () => {
    it('rejects a doctorId that does not exist in this clinic', async () => {
      const { service, prisma } = makeService();
      prisma.doctor.count.mockResolvedValue(1); // only 1 of 2 requested doctors matched

      await expect(
        service.create('clinic-a', {
          branchId: 'branch-1',
          name: 'OPD',
          code: 'OPD',
          doctorIds: ['doc-1', 'doc-2'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('assigns existing clinic doctors to the new department', async () => {
      const { service, prisma } = makeService();
      prisma.doctor.count.mockResolvedValue(1);
      prisma.department.create.mockResolvedValue({
        ...departmentRow,
        doctors: [{ doctorId: 'doc-1' }],
      });

      const result = await service.create('clinic-a', {
        branchId: 'branch-1',
        name: 'OPD',
        code: 'OPD',
        doctorIds: ['doc-1'],
      });

      expect(result.doctorIds).toEqual(['doc-1']);
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.doctor.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: ['doc-1'] }, clinicId: 'clinic-a' }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });
  });

  describe('findById (tenant isolation)', () => {
    it('scopes the lookup by clinicId and 404s when not found in this clinic', async () => {
      const { service, prisma } = makeService();
      prisma.department.findFirst.mockResolvedValue(null);

      await expect(service.findById('clinic-a', 'dept-1')).rejects.toThrow(NotFoundException);

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.department.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'dept-1', clinicId: 'clinic-a' }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('a department belonging to another clinic is not returned even by id', async () => {
      const { service, prisma } = makeService();
      prisma.department.findFirst.mockResolvedValue(null);

      await expect(service.findById('clinic-b', 'dept-1')).rejects.toThrow(NotFoundException);
    });

    it('returns the department, including its branch, when it belongs to the caller clinic', async () => {
      const { service, prisma } = makeService();
      prisma.department.findFirst.mockResolvedValue(departmentRow);

      const result = await service.findById('clinic-a', 'dept-1');
      expect(result.id).toBe('dept-1');
      expect(result.clinicId).toBe('clinic-a');
      expect(result.branch).toEqual({ id: 'branch-1', name: 'Main Branch', code: 'MAIN' });
    });
  });

  describe('findAll pagination/filtering', () => {
    it('applies clinicId, branchId, pagination, and search to the query', async () => {
      const { service, prisma } = makeService();
      prisma.department.count.mockResolvedValue(42);
      prisma.department.findMany.mockResolvedValue([departmentRow]);

      const result = await service.findAll('clinic-a', {
        page: 2,
        pageSize: 10,
        branchId: 'branch-1',
        search: 'cardio',
      });

      expect(result.meta).toEqual({ total: 42, page: 2, pageSize: 10 });
      expect(result.data).toHaveLength(1);

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.department.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ clinicId: 'clinic-a', branchId: 'branch-1' }),
          skip: 10,
          take: 10,
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });
  });

  describe('update', () => {
    it('rejects updating an archived department', async () => {
      const { service, prisma } = makeService();
      prisma.department.findFirst.mockResolvedValue({ ...departmentRow, status: 'ARCHIVED' });

      await expect(service.update('clinic-a', 'dept-1', { name: 'Renamed' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects renaming to a code already used by another department in the same branch', async () => {
      const { service, prisma } = makeService();
      prisma.department.findFirst
        .mockResolvedValueOnce(departmentRow) // findActiveDepartmentOrThrow
        .mockResolvedValueOnce({ ...departmentRow, id: 'dept-2' }); // code check hits

      await expect(service.update('clinic-a', 'dept-1', { code: 'OTHER' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects moving to a branch that does not belong to the caller clinic', async () => {
      const { service, prisma } = makeService();
      prisma.department.findFirst.mockResolvedValueOnce(departmentRow); // findActiveDepartmentOrThrow
      prisma.branch.findFirst.mockResolvedValue(null); // branch not in this clinic

      await expect(
        service.update('clinic-a', 'dept-1', { branchId: 'branch-foreign' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('replaces the doctor assignment set when doctorIds is given', async () => {
      const { service, prisma } = makeService();
      prisma.department.findFirst.mockResolvedValueOnce(departmentRow);
      prisma.doctor.count.mockResolvedValue(1);
      prisma.department.update.mockResolvedValue({
        ...departmentRow,
        doctors: [{ doctorId: 'doc-2' }],
      });

      const result = await service.update('clinic-a', 'dept-1', { doctorIds: ['doc-2'] });

      expect(prisma.doctorDepartment.deleteMany).toHaveBeenCalledWith({
        where: { departmentId: 'dept-1' },
      });
      expect(prisma.doctorDepartment.createMany).toHaveBeenCalledWith({
        data: [{ doctorId: 'doc-2', departmentId: 'dept-1' }],
      });
      expect(result.doctorIds).toEqual(['doc-2']);
    });
  });

  describe('updateStatus', () => {
    it('rejects changing status on an archived department', async () => {
      const { service, prisma } = makeService();
      prisma.department.findFirst.mockResolvedValue({ ...departmentRow, status: 'ARCHIVED' });

      await expect(service.updateStatus('clinic-a', 'dept-1', 'INACTIVE')).rejects.toThrow(
        ConflictException,
      );
    });

    it('updates status scoped to the caller clinic', async () => {
      const { service, prisma } = makeService();
      prisma.department.findFirst.mockResolvedValue(departmentRow);
      prisma.department.update.mockResolvedValue({ ...departmentRow, status: 'INACTIVE' });

      const result = await service.updateStatus('clinic-a', 'dept-1', 'INACTIVE');
      expect(result.status).toBe('INACTIVE');
    });
  });

  describe('archive', () => {
    it('sets status to ARCHIVED', async () => {
      const { service, prisma } = makeService();
      prisma.department.findFirst.mockResolvedValue(departmentRow);
      prisma.department.update.mockResolvedValue({ ...departmentRow, status: 'ARCHIVED' });

      const result = await service.archive('clinic-a', 'dept-1');

      expect(result.status).toBe('ARCHIVED');
      expect(prisma.department.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dept-1' },
          data: { status: 'ARCHIVED' },
        }),
      );
    });

    it('rejects archiving an already-archived department', async () => {
      const { service, prisma } = makeService();
      prisma.department.findFirst.mockResolvedValue({ ...departmentRow, status: 'ARCHIVED' });

      await expect(service.archive('clinic-a', 'dept-1')).rejects.toThrow(ConflictException);
    });

    it('404s for a department outside the caller clinic (tenant isolation)', async () => {
      const { service, prisma } = makeService();
      prisma.department.findFirst.mockResolvedValue(null);

      await expect(service.archive('clinic-b', 'dept-1')).rejects.toThrow(NotFoundException);
    });
  });
});
