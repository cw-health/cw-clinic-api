import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { BranchesService } from './branches.service';

const branchRow = {
  id: 'branch-1',
  clinicId: 'clinic-a',
  name: 'Main Branch',
  code: 'MAIN',
  phone: null,
  email: null,
  address: null,
  city: null,
  state: null,
  postalCode: null,
  country: null,
  timezone: 'UTC',
  status: 'ACTIVE',
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeService(overrides?: Partial<Record<string, unknown>>) {
  const prisma = {
    clinic: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Kolkata' }) },
    branch: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
    },
    ...overrides,
  };
  (prisma as Record<string, unknown>).$transaction = jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: unknown) => unknown)(prisma);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
  const service = new BranchesService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('BranchesService', () => {
  describe('create', () => {
    it('rejects a duplicate code within the same clinic', async () => {
      const { service, prisma } = makeService();
      prisma.branch.findFirst.mockResolvedValueOnce(branchRow); // code check hits

      await expect(
        service.create('clinic-a', { name: 'Second Branch', code: 'MAIN' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a duplicate name within the same clinic', async () => {
      const { service, prisma } = makeService();
      prisma.branch.findFirst
        .mockResolvedValueOnce(null) // code check passes
        .mockResolvedValueOnce(branchRow); // name check hits

      await expect(
        service.create('clinic-a', { name: 'Main Branch', code: 'SECOND' }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows the same code/name to be reused across different clinics', async () => {
      const { service, prisma } = makeService();
      prisma.branch.create.mockResolvedValue(branchRow);

      await service.create('clinic-a', { name: 'Main Branch', code: 'MAIN' });

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.branch.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ clinicId: 'clinic-a' }) }),
      );
      expect(prisma.branch.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ clinicId: 'clinic-a' }) }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('defaults timezone from the clinic when none is given', async () => {
      const { service, prisma } = makeService();
      prisma.branch.create.mockResolvedValue(branchRow);

      await service.create('clinic-a', { name: 'Main Branch', code: 'MAIN' });

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.branch.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ timezone: 'Asia/Kolkata' }) }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });
  });

  describe('findById (tenant isolation)', () => {
    it('scopes the lookup by clinicId and 404s when not found in this clinic', async () => {
      const { service, prisma } = makeService();
      prisma.branch.findFirst.mockResolvedValue(null);

      await expect(service.findById('clinic-a', 'branch-1')).rejects.toThrow(NotFoundException);

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.branch.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'branch-1', clinicId: 'clinic-a' }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('a branch belonging to another clinic is not returned even by id', async () => {
      const { service, prisma } = makeService();
      // Simulates the DB correctly filtering — a cross-tenant row never
      // matches the where clause, so the fake returns null exactly like a
      // real findFirst({ where: { id, clinicId } }) would for a foreign row.
      prisma.branch.findFirst.mockResolvedValue(null);

      await expect(service.findById('clinic-b', 'branch-1')).rejects.toThrow(NotFoundException);
    });

    it('returns the branch when it belongs to the caller clinic', async () => {
      const { service, prisma } = makeService();
      prisma.branch.findFirst.mockResolvedValue(branchRow);

      const result = await service.findById('clinic-a', 'branch-1');
      expect(result.id).toBe('branch-1');
      expect(result.clinicId).toBe('clinic-a');
    });
  });

  describe('findAll pagination/search', () => {
    it('applies clinicId, pagination, and search to the query', async () => {
      const { service, prisma } = makeService();
      prisma.branch.count.mockResolvedValue(42);
      prisma.branch.findMany.mockResolvedValue([branchRow]);

      const result = await service.findAll('clinic-a', { page: 2, pageSize: 10, search: 'main' });

      expect(result.meta).toEqual({ total: 42, page: 2, pageSize: 10 });
      expect(result.data).toHaveLength(1);

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.branch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ clinicId: 'clinic-a' }),
          skip: 10,
          take: 10,
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });
  });

  describe('update', () => {
    it('rejects updating an archived branch', async () => {
      const { service, prisma } = makeService();
      prisma.branch.findFirst.mockResolvedValue({ ...branchRow, status: 'ARCHIVED' });

      await expect(service.update('clinic-a', 'branch-1', { name: 'Renamed' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects renaming to a code already used by another branch in the same clinic', async () => {
      const { service, prisma } = makeService();
      prisma.branch.findFirst
        .mockResolvedValueOnce(branchRow) // findActiveBranchOrThrow
        .mockResolvedValueOnce({ ...branchRow, id: 'branch-2' }); // code check hits

      await expect(service.update('clinic-a', 'branch-1', { code: 'OTHER' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('updateStatus', () => {
    it('rejects changing status on an archived branch', async () => {
      const { service, prisma } = makeService();
      prisma.branch.findFirst.mockResolvedValue({ ...branchRow, status: 'ARCHIVED' });

      await expect(service.updateStatus('clinic-a', 'branch-1', 'INACTIVE')).rejects.toThrow(
        ConflictException,
      );
    });

    it('updates status scoped to the caller clinic', async () => {
      const { service, prisma } = makeService();
      prisma.branch.findFirst.mockResolvedValue(branchRow);
      prisma.branch.update.mockResolvedValue({ ...branchRow, status: 'INACTIVE' });

      const result = await service.updateStatus('clinic-a', 'branch-1', 'INACTIVE');
      expect(result.status).toBe('INACTIVE');
    });
  });

  describe('archive', () => {
    it('sets status to ARCHIVED', async () => {
      const { service, prisma } = makeService();
      prisma.branch.findFirst.mockResolvedValue(branchRow);
      prisma.branch.update.mockResolvedValue({ ...branchRow, status: 'ARCHIVED' });

      const result = await service.archive('clinic-a', 'branch-1');

      expect(result.status).toBe('ARCHIVED');

      expect(prisma.branch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'branch-1' },
          data: { status: 'ARCHIVED' },
        }),
      );
    });

    it('rejects archiving an already-archived branch', async () => {
      const { service, prisma } = makeService();
      prisma.branch.findFirst.mockResolvedValue({ ...branchRow, status: 'ARCHIVED' });

      await expect(service.archive('clinic-a', 'branch-1')).rejects.toThrow(ConflictException);
    });

    it('404s for a branch outside the caller clinic (tenant isolation)', async () => {
      const { service, prisma } = makeService();
      prisma.branch.findFirst.mockResolvedValue(null);

      await expect(service.archive('clinic-b', 'branch-1')).rejects.toThrow(NotFoundException);
    });
  });
});
