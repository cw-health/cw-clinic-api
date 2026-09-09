import type { PrismaService } from '../prisma/prisma.service';
import { AuditService, type RecordAuditEventInput } from './audit.service';

function makeService() {
  const create = jest
    .fn<Promise<void>, [{ data: RecordAuditEventInput }]>()
    .mockResolvedValue(undefined);
  const prisma = { auditLog: { create } };
  return { service: new AuditService(prisma as unknown as PrismaService), create };
}

/** Builds a prisma mock for the `query()` (SA-05) read-path tests below. */
function makeQueryService() {
  const prisma = {
    auditLog: { count: jest.fn(), findMany: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    clinic: { findMany: jest.fn().mockResolvedValue([]) },
    clinicMembership: { findMany: jest.fn().mockResolvedValue([]) },
  };
  (prisma as Record<string, unknown>).$transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(prisma);
  });
  const service = new AuditService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('AuditService', () => {
  it('records a tenant action with clinicId and actorType TENANT_USER (existing caller shape, no actorType passed)', async () => {
    const { service, create } = makeService();

    await service.record({
      clinicId: 'clinic-1',
      actorUserId: 'user-1',
      entity: 'Invoice',
      entityId: 'inv-1',
      action: 'invoice.created',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        clinicId: 'clinic-1',
        actorUserId: 'user-1',
        entity: 'Invoice',
        entityId: 'inv-1',
        action: 'invoice.created',
        actorType: 'TENANT_USER',
      },
    });
  });

  it('records a platform action with clinicId null and actorType PLATFORM_USER when explicitly passed', async () => {
    const { service, create } = makeService();

    await service.record({
      clinicId: null,
      actorUserId: 'super-admin-1',
      actorType: 'PLATFORM_USER',
      entity: 'Clinic',
      entityId: 'clinic-2',
      action: 'clinic.created',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        clinicId: null,
        actorUserId: 'super-admin-1',
        actorType: 'PLATFORM_USER',
        entity: 'Clinic',
        entityId: 'clinic-2',
        action: 'clinic.created',
      },
    });
  });

  it('never derives actorType from anything but the explicit caller-supplied value (server-determined, not client input)', async () => {
    const { service, create } = makeService();

    // Simulates a caller building the input from a request body that a
    // malicious client tried to smuggle an actorType/clinicId override
    // into — the service only ever uses the typed fields a server-side
    // caller passes in, there is no "read actorType off the request" path.
    const clientSuppliedBody = { actorType: 'PLATFORM_USER', clinicId: 'someone-elses-clinic' };
    void clientSuppliedBody;

    await service.record({
      clinicId: 'clinic-1',
      actorUserId: 'user-1',
      entity: 'Payment',
      entityId: 'pay-1',
      action: 'payment.recorded',
    });

    const [[{ data: written }]] = create.mock.calls;
    expect(written.actorType).toBe('TENANT_USER');
    expect(written.clinicId).toBe('clinic-1');
  });

  it('passes requestId/ipAddress/userAgent through to the write when supplied (Phase 1F)', async () => {
    const { service, create } = makeService();

    await service.record({
      clinicId: 'clinic-1',
      actorUserId: 'user-1',
      entity: 'Patient',
      entityId: 'patient-1',
      action: 'patient.viewed',
      requestId: 'req-abc',
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        clinicId: 'clinic-1',
        actorUserId: 'user-1',
        entity: 'Patient',
        entityId: 'patient-1',
        action: 'patient.viewed',
        actorType: 'TENANT_USER',
        requestId: 'req-abc',
        ipAddress: '203.0.113.7',
        userAgent: 'Mozilla/5.0',
      },
    });
  });

  it("never writes a password/token field — the write payload is limited to RecordAuditEventInput's typed shape", async () => {
    const { service, create } = makeService();

    await service.record({
      clinicId: 'clinic-1',
      actorUserId: 'user-1',
      entity: 'User',
      entityId: 'user-2',
      action: 'user.created',
      changedFields: 'email,firstName,lastName',
    });

    const [[{ data: written }]] = create.mock.calls;
    const writtenKeys = Object.keys(written);
    for (const forbidden of ['password', 'passwordHash', 'accessToken', 'refreshToken', 'token']) {
      expect(writtenKeys).not.toContain(forbidden);
    }
  });

  it('swallows a write failure and does not throw (must never fail the business transaction)', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db unavailable'));
    const prisma = { auditLog: { create } };
    const service = new AuditService(prisma as unknown as PrismaService);

    await expect(
      service.record({
        clinicId: 'clinic-1',
        actorUserId: 'user-1',
        entity: 'Document',
        entityId: 'doc-1',
        action: 'document.uploaded',
      }),
    ).resolves.toBeUndefined();
  });

  describe('query (SA-05 read surface)', () => {
    it('is append-only: no update or delete method exists on the service', () => {
      const { service } = makeQueryService();
      expect((service as unknown as Record<string, unknown>).update).toBeUndefined();
      expect((service as unknown as Record<string, unknown>).delete).toBeUndefined();
    });

    it('paginates and defaults to createdAt desc', async () => {
      const { service, prisma } = makeQueryService();
      prisma.auditLog.count.mockResolvedValue(1);
      prisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'log-1',
          clinicId: null,
          actorUserId: 'user-1',
          actorType: 'PLATFORM_USER',
          entity: 'Clinic',
          entityId: 'clinic-1',
          action: 'CREATE',
          changedFields: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);

      const result = await service.query({ page: 2, pageSize: 10 });

      expect(result.meta).toEqual({ total: 1, page: 2, pageSize: 10 });
      expect(result.data[0]).toMatchObject({ id: 'log-1', entity: 'Clinic', action: 'CREATE' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' }, skip: 10, take: 10 }),
      );
    });

    it('filters by actorUserId, action, entity, entityId, and clinicId', async () => {
      const { service, prisma } = makeQueryService();
      prisma.auditLog.count.mockResolvedValue(0);
      prisma.auditLog.findMany.mockResolvedValue([]);

      await service.query({
        actorUserId: 'user-1',
        action: 'UPDATE',
        entity: 'Invoice',
        entityId: 'inv-42',
        clinicId: 'clinic-1',
      });

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            actorUserId: 'user-1',
            action: 'UPDATE',
            entity: 'Invoice',
            entityId: 'inv-42',
            clinicId: 'clinic-1',
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('filters by an inclusive/exclusive createdAt date range', async () => {
      const { service, prisma } = makeQueryService();
      prisma.auditLog.count.mockResolvedValue(0);
      prisma.auditLog.findMany.mockResolvedValue([]);

      await service.query({
        dateFrom: '2026-01-01T00:00:00.000Z',
        dateTo: '2026-02-01T00:00:00.000Z',
      });

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              gte: new Date('2026-01-01T00:00:00.000Z'),
              lt: new Date('2026-02-01T00:00:00.000Z'),
            },
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('search matches entity, action, entityId, and changedFields via OR', async () => {
      const { service, prisma } = makeQueryService();
      prisma.auditLog.count.mockResolvedValue(0);
      prisma.auditLog.findMany.mockResolvedValue([]);

      await service.query({ search: 'clinic-42' });

      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- test mock, loosely typed by design */
      const call = prisma.auditLog.findMany.mock.calls[0][0];
      expect(call.where.OR).toEqual([
        { entity: { contains: 'clinic-42' } },
        { action: { contains: 'clinic-42' } },
        { entityId: { contains: 'clinic-42' } },
        { changedFields: { contains: 'clinic-42' } },
      ]);
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
    });

    it('resolves actor and clinic display info via batched lookups, never selecting passwordHash', async () => {
      const { service, prisma } = makeQueryService();
      prisma.auditLog.count.mockResolvedValue(1);
      prisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'log-1',
          clinicId: 'clinic-1',
          actorUserId: 'user-1',
          actorType: 'TENANT_USER',
          entity: 'Invoice',
          entityId: 'inv-1',
          action: 'UPDATE',
          changedFields: 'status',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@clinic.test' },
      ]);
      prisma.clinic.findMany.mockResolvedValue([{ id: 'clinic-1', name: 'Downtown Clinic' }]);

      const result = await service.query({});

      expect(result.data[0].actor).toEqual({
        id: 'user-1',
        name: 'Ada Lovelace',
        email: 'ada@clinic.test',
      });
      expect(result.data[0].clinic).toEqual({ id: 'clinic-1', name: 'Downtown Clinic' });
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- test mock, loosely typed by design */
      const userSelect = prisma.user.findMany.mock.calls[0][0].select;
      expect(userSelect).not.toHaveProperty('passwordHash');
      expect(Object.keys(userSelect)).not.toContain('passwordHash');
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
    });

    it('returns actor: null and clinic: null when the referenced rows cannot be resolved', async () => {
      const { service, prisma } = makeQueryService();
      prisma.auditLog.count.mockResolvedValue(1);
      prisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'log-1',
          clinicId: 'deleted-clinic',
          actorUserId: 'deleted-user',
          actorType: 'TENANT_USER',
          entity: 'Invoice',
          entityId: 'inv-1',
          action: 'UPDATE',
          changedFields: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);
      // Both lookups come back empty — the referenced rows no longer exist.

      const result = await service.query({});

      expect(result.data[0].actor).toBeNull();
      expect(result.data[0].clinic).toBeNull();
    });

    it('exposes requestId/ipAddress/userAgent on each returned row', async () => {
      const { service, prisma } = makeQueryService();
      prisma.auditLog.count.mockResolvedValue(1);
      prisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'log-1',
          clinicId: 'clinic-1',
          actorUserId: 'user-1',
          actorType: 'TENANT_USER',
          entity: 'Patient',
          entityId: 'patient-1',
          action: 'patient.viewed',
          changedFields: null,
          requestId: 'req-1',
          ipAddress: '203.0.113.7',
          userAgent: 'jest',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);

      const result = await service.query({});
      expect(result.data[0]).toMatchObject({
        requestId: 'req-1',
        ipAddress: '203.0.113.7',
        userAgent: 'jest',
      });
    });

    it("filters by the acting user's current branch/department assignment (best-effort, via ClinicMembership)", async () => {
      const { service, prisma } = makeQueryService();
      prisma.clinicMembership.findMany.mockResolvedValue([
        { userId: 'user-1' },
        { userId: 'user-2' },
      ]);
      prisma.auditLog.count.mockResolvedValue(0);
      prisma.auditLog.findMany.mockResolvedValue([]);

      await service.query({ clinicId: 'clinic-1', branchId: 'branch-1' });

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.clinicMembership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ clinicId: 'clinic-1', branchId: 'branch-1' }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- test mock, loosely typed by design */
      const call: { where: { actorUserId: unknown } } = prisma.auditLog.findMany.mock.calls[0][0];
      expect(call.where.actorUserId).toEqual({ in: ['user-1', 'user-2'] });
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
    });

    it('skips the ClinicMembership lookup entirely when no branch/department filter is given', async () => {
      const { service, prisma } = makeQueryService();
      prisma.auditLog.count.mockResolvedValue(0);
      prisma.auditLog.findMany.mockResolvedValue([]);

      await service.query({ clinicId: 'clinic-1' });

      expect(prisma.clinicMembership.findMany).not.toHaveBeenCalled();
    });

    it('skips the actor/clinic lookups entirely when the page is empty', async () => {
      const { service, prisma } = makeQueryService();
      prisma.auditLog.count.mockResolvedValue(0);
      prisma.auditLog.findMany.mockResolvedValue([]);

      const result = await service.query({});

      expect(result.data).toEqual([]);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(prisma.clinic.findMany).not.toHaveBeenCalled();
    });
  });
});
