import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { PatientsService } from './patients.service';

const patientRole = { id: 'role-patient', name: 'Patient' };

const patientRow = {
  id: 'patient-1',
  clinicId: 'clinic-a',
  userId: null,
  mrn: 'P-000001',
  firstName: 'Jane',
  lastName: 'Doe',
  gender: null,
  dateOfBirth: null,
  phone: '555-0100',
  email: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  country: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  knownAllergies: null,
  chronicConditions: null,
  status: 'ACTIVE',
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeService(overrides?: Partial<Record<string, unknown>>) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    role: { findFirst: jest.fn().mockResolvedValue(patientRole) },
    clinicMembership: { create: jest.fn().mockResolvedValue({}) },
    patient: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    ...overrides,
  };
  (prisma as Record<string, unknown>).$transaction = jest.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(prisma);
  });
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new PatientsService(
    prisma as unknown as PrismaService,
    auditService as unknown as AuditService,
  );
  return { service, prisma, auditService };
}

describe('PatientsService', () => {
  describe('create', () => {
    it('generates a sequential MRN scoped to the clinic', async () => {
      const { service, prisma } = makeService();
      prisma.patient.count.mockResolvedValue(5); // 5 existing patients in this clinic
      prisma.patient.create.mockResolvedValue({ ...patientRow, mrn: 'P-000006' });

      await service.create('clinic-a', { firstName: 'Jane', lastName: 'Doe' }, 'staff-1');

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.patient.count).toHaveBeenCalledWith({ where: { clinicId: 'clinic-a' } });
      expect(prisma.patient.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ clinicId: 'clinic-a', mrn: 'P-000006' }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('rejects createPortalAccount without an email', async () => {
      const { service } = makeService();
      await expect(
        service.create(
          'clinic-a',
          {
            firstName: 'Jane',
            lastName: 'Doe',
            createPortalAccount: true,
            temporaryPassword: 'Password123!',
          },
          'staff-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a duplicate email when creating a portal account', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create(
          'clinic-a',
          {
            firstName: 'Jane',
            lastName: 'Doe',
            email: 'dup@test.com',
            createPortalAccount: true,
            temporaryPassword: 'Password123!',
          },
          'staff-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('provisions a User + ClinicMembership when createPortalAccount is set', async () => {
      const { service, prisma } = makeService();
      prisma.user.create.mockResolvedValue({ id: 'new-user' });
      prisma.patient.create.mockResolvedValue({ ...patientRow, userId: 'new-user' });

      await service.create(
        'clinic-a',
        {
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@test.com',
          createPortalAccount: true,
          temporaryPassword: 'Password123!',
        },
        'staff-1',
      );

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.clinicMembership.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ clinicId: 'clinic-a', roleId: 'role-patient' }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });
  });

  describe('findById (tenant isolation)', () => {
    it('scopes the lookup by clinicId', async () => {
      const { service, prisma } = makeService();
      prisma.patient.findFirst.mockResolvedValue(patientRow);

      await service.findById('clinic-a', 'patient-1');

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.patient.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'patient-1', clinicId: 'clinic-a' }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('404s for a patient outside the caller clinic', async () => {
      const { service, prisma } = makeService();
      prisma.patient.findFirst.mockResolvedValue(null);

      await expect(service.findById('clinic-b', 'patient-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll pagination/search', () => {
    it('applies clinicId, pagination, and search to the query', async () => {
      const { service, prisma } = makeService();
      prisma.patient.count.mockResolvedValue(3);
      prisma.patient.findMany.mockResolvedValue([patientRow]);

      const result = await service.findAll('clinic-a', {
        page: 1,
        pageSize: 20,
        search: 'jane',
      });

      expect(result.meta).toEqual({ total: 3, page: 1, pageSize: 20 });

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.patient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ clinicId: 'clinic-a' }) }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('a multi-word search ("Jane Doe") requires each word to match, not the whole phrase against one column', async () => {
      const { service, prisma } = makeService();
      prisma.patient.count.mockResolvedValue(1);
      prisma.patient.findMany.mockResolvedValue([patientRow]);

      await service.findAll('clinic-a', { page: 1, pageSize: 20, search: 'Jane Doe' });

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.patient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: [
              {
                OR: [
                  { firstName: { contains: 'Jane' } },
                  { lastName: { contains: 'Jane' } },
                  { phone: { contains: 'Jane' } },
                  { email: { contains: 'Jane' } },
                  { mrn: { contains: 'Jane' } },
                ],
              },
              {
                OR: [
                  { firstName: { contains: 'Doe' } },
                  { lastName: { contains: 'Doe' } },
                  { phone: { contains: 'Doe' } },
                  { email: { contains: 'Doe' } },
                  { mrn: { contains: 'Doe' } },
                ],
              },
            ],
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });
  });

  describe('updateOwn', () => {
    it('404s when no patient profile is linked to this user in this clinic', async () => {
      const { service, prisma } = makeService();
      prisma.patient.findFirst.mockResolvedValue(null);

      await expect(service.updateOwn('clinic-a', 'user-1', { phone: '555-0199' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('audit trail (Phase 1F)', () => {
    it('records PATIENT_CREATED with field names only, never values', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.patient.create.mockResolvedValue(patientRow);

      await service.create(
        'clinic-a',
        { firstName: 'Jane', lastName: 'Doe', phone: '555-0100' },
        'staff-1',
        { requestId: 'req-1', ipAddress: '10.0.0.1', userAgent: 'jest' },
      );

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: 'clinic-a',
          actorUserId: 'staff-1',
          entity: 'Patient',
          action: 'patient.created',
          requestId: 'req-1',
          ipAddress: '10.0.0.1',
          userAgent: 'jest',
        }),
      );
      /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock, loosely typed by design */
      const call = auditService.record.mock.calls[0][0] as { changedFields: string };
      expect(call.changedFields).not.toMatch(/Jane|Doe|555-0100/);
    });

    it('records PATIENT_VIEWED on findByIdAudited (PHI access) but not on plain findById', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.patient.findFirst.mockResolvedValue(patientRow);

      await service.findById('clinic-a', 'patient-1');
      expect(auditService.record).not.toHaveBeenCalled();

      await service.findByIdAudited('clinic-a', 'patient-1', 'staff-1');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: 'clinic-a',
          actorUserId: 'staff-1',
          entity: 'Patient',
          entityId: 'patient-1',
          action: 'patient.viewed',
        }),
      );
    });

    it('records PATIENT_UPDATED with only the changed field names', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.patient.findFirst.mockResolvedValue(patientRow);
      prisma.patient.update.mockResolvedValue({ ...patientRow, phone: '555-0199' });

      await service.update('clinic-a', 'patient-1', { phone: '555-0199' }, 'staff-1');

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'Patient',
          entityId: 'patient-1',
          action: 'patient.updated',
          changedFields: 'phone',
        }),
      );
    });

    it('scopes the write itself by clinicId, not only the earlier read', async () => {
      const { service, prisma } = makeService();
      prisma.patient.findFirst.mockResolvedValue(patientRow);

      await service.update('clinic-a', 'patient-1', { phone: '555-0199' }, 'staff-1');

      expect(prisma.patient.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'patient-1', clinicId: 'clinic-a' } }),
      );
    });

    it('404s instead of writing when updateMany matches no row (cross-tenant id reuse)', async () => {
      const { service, prisma } = makeService();
      prisma.patient.findFirst.mockResolvedValue(patientRow);
      prisma.patient.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.update('clinic-a', 'patient-1', { phone: '555-0199' }, 'staff-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('countActive / countActiveGroupedByClinic (SA-09)', () => {
    it('counts only ACTIVE, non-deleted patients for one clinic', async () => {
      const { service, prisma } = makeService();
      prisma.patient.count.mockResolvedValue(7);

      const result = await service.countActive('clinic-a');

      expect(result).toBe(7);
      expect(prisma.patient.count).toHaveBeenCalledWith({
        where: { clinicId: 'clinic-a', status: 'ACTIVE', deletedAt: null },
      });
    });

    it('returns an empty map without querying when given no clinic ids', async () => {
      const { service, prisma } = makeService();

      const result = await service.countActiveGroupedByClinic([]);

      expect(result.size).toBe(0);
      expect(prisma.patient.groupBy).not.toHaveBeenCalled();
    });

    it('groups counts by clinic in a single aggregate query', async () => {
      const { service, prisma } = makeService();
      prisma.patient.groupBy.mockResolvedValue([
        { clinicId: 'clinic-a', _count: { _all: 40 } },
        { clinicId: 'clinic-b', _count: { _all: 12 } },
      ]);

      const result = await service.countActiveGroupedByClinic(['clinic-a', 'clinic-b']);

      expect(result.get('clinic-a')).toBe(40);
      expect(result.get('clinic-b')).toBe(12);
      expect(result.get('clinic-c')).toBeUndefined();
    });
  });

  describe('duplicate detection', () => {
    it('checkDuplicates returns no matches when nothing usable to match on is given', async () => {
      const { service, prisma } = makeService();

      const result = await service.checkDuplicates('clinic-a', {});

      expect(result).toEqual([]);
      expect(prisma.patient.findMany).not.toHaveBeenCalled();
    });

    it('checkDuplicates tags each candidate with which rule(s) matched', async () => {
      const { service, prisma } = makeService();
      prisma.patient.findMany.mockResolvedValue([patientRow]);

      const result = await service.checkDuplicates('clinic-a', { phone: '555-0100' });

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(result).toEqual([
        { patient: expect.objectContaining({ id: 'patient-1' }), matchedOn: ['PHONE'] },
      ]);
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('create() rejects with a 409 + candidate list when a duplicate is found and not confirmed', async () => {
      const { service, prisma } = makeService();
      prisma.patient.findMany.mockResolvedValue([patientRow]);

      await expect(
        service.create(
          'clinic-a',
          { firstName: 'Jane', lastName: 'Doe', phone: '555-0100' },
          'staff-1',
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.patient.create).not.toHaveBeenCalled();
    });

    it('create() proceeds and records PATIENT_DUPLICATE_OVERRIDDEN when confirmDuplicate is set', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.patient.findMany.mockResolvedValue([patientRow]);
      prisma.patient.create.mockResolvedValue({ ...patientRow, id: 'patient-2' });

      await service.create(
        'clinic-a',
        { firstName: 'Jane', lastName: 'Doe', phone: '555-0100', confirmDuplicate: true },
        'staff-1',
      );

      expect(prisma.patient.create).toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'patient.duplicate_overridden',
          changedFields: 'patient-1',
        }),
      );
    });

    it('update() only re-checks duplicates when a duplicate-sensitive field actually changes', async () => {
      const { service, prisma } = makeService();
      prisma.patient.findFirst.mockResolvedValue(patientRow);
      prisma.patient.update.mockResolvedValue(patientRow);

      await service.update('clinic-a', 'patient-1', { knownAllergies: 'Penicillin' }, 'staff-1');

      expect(prisma.patient.findMany).not.toHaveBeenCalled();
    });

    it('update() excludes the patient itself from its own duplicate check', async () => {
      const { service, prisma } = makeService();
      prisma.patient.findFirst.mockResolvedValue(patientRow);
      prisma.patient.findMany.mockResolvedValue([]);
      prisma.patient.update.mockResolvedValue({ ...patientRow, phone: '555-0199' });

      await service.update('clinic-a', 'patient-1', { phone: '555-0199' }, 'staff-1');

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.patient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 'patient-1' } }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });
  });

  describe('MRN generation race handling', () => {
    it('retries with a freshly generated MRN on a unique-constraint collision', async () => {
      const { service, prisma } = makeService();
      prisma.patient.count.mockResolvedValueOnce(5).mockResolvedValueOnce(6);
      prisma.patient.create
        .mockRejectedValueOnce({ code: 'P2002' })
        .mockResolvedValueOnce({ ...patientRow, mrn: 'P-000007' });

      const result = await service.create(
        'clinic-a',
        { firstName: 'Jane', lastName: 'Doe' },
        'staff-1',
      );

      expect(prisma.patient.create).toHaveBeenCalledTimes(2);
      expect(result.mrn).toBe('P-000007');
    });

    it('gives up and rethrows after repeated collisions', async () => {
      const { service, prisma } = makeService();
      prisma.patient.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.create('clinic-a', { firstName: 'Jane', lastName: 'Doe' }, 'staff-1'),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('does not swallow an unrelated create error', async () => {
      const { service, prisma } = makeService();
      prisma.patient.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.create('clinic-a', { firstName: 'Jane', lastName: 'Doe' }, 'staff-1'),
      ).rejects.toThrow('db down');
      expect(prisma.patient.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('status transitions (activate / deactivate / archive / restore)', () => {
    it('activate() sets status back to ACTIVE and records PATIENT_ACTIVATED', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.patient.findFirst.mockResolvedValue({ ...patientRow, status: 'INACTIVE' });

      await service.activate('clinic-a', 'patient-1', 'staff-1');

      expect(prisma.patient.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'ACTIVE' } }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'patient.activated' }),
      );
    });

    it('archive() sets status to ARCHIVED and records PATIENT_ARCHIVED', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.patient.findFirst.mockResolvedValue(patientRow);

      await service.archive('clinic-a', 'patient-1', 'staff-1');

      expect(prisma.patient.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'ARCHIVED' } }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'patient.archived' }),
      );
    });

    it('archive() rejects an already-archived patient', async () => {
      const { service, prisma } = makeService();
      prisma.patient.findFirst.mockResolvedValue({ ...patientRow, status: 'ARCHIVED' });

      await expect(service.archive('clinic-a', 'patient-1', 'staff-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('activate()/deactivate() reject an archived patient — restore() first', async () => {
      const { service, prisma } = makeService();
      prisma.patient.findFirst.mockResolvedValue({ ...patientRow, status: 'ARCHIVED' });

      await expect(service.activate('clinic-a', 'patient-1', 'staff-1')).rejects.toThrow(
        ConflictException,
      );
      await expect(service.deactivate('clinic-a', 'patient-1', 'staff-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('restore() rejects a patient that is not archived', async () => {
      const { service, prisma } = makeService();
      prisma.patient.findFirst.mockResolvedValue(patientRow);

      await expect(service.restore('clinic-a', 'patient-1', 'staff-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('restore() sets an archived patient back to ACTIVE and records PATIENT_RESTORED', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.patient.findFirst.mockResolvedValue({ ...patientRow, status: 'ARCHIVED' });

      await service.restore('clinic-a', 'patient-1', 'staff-1');

      expect(prisma.patient.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'ACTIVE' } }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'patient.restored' }),
      );
    });
  });
});
