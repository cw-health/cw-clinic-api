import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { AuditService } from '../audit/audit.service';
import type { ClinicsService } from '../clinics/clinics.service';
import type { ConsultationsService } from '../consultations/consultations.service';
import type { DoctorsService } from '../doctors/doctors.service';
import type { MedicinesService } from '../medicines/medicines.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PatientsService } from '../patients/patients.service';
import type { PrismaService } from '../prisma/prisma.service';
import { PrescriptionsService } from './prescriptions.service';

const consultationDto = {
  id: 'consult-1',
  clinicId: 'clinic-a',
  doctorId: 'doctor-1',
  patientId: 'patient-1',
};
const doctorDto = { id: 'doctor-1', clinicId: 'clinic-a', firstName: 'Ada', lastName: 'Lovelace' };
const patientDto = {
  id: 'patient-1',
  clinicId: 'clinic-a',
  userId: null,
  firstName: 'Grace',
  lastName: 'Hopper',
};

const basePrescription = {
  id: 'rx-1',
  clinicId: 'clinic-a',
  consultationId: 'consult-1',
  doctorId: 'doctor-1',
  patientId: 'patient-1',
  status: 'DRAFT',
  version: 1,
  amendsId: null,
  notes: null,
  createdByUserId: 'user-doctor',
  finalizedAt: null,
  supersededAt: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [
    {
      id: 'item-1',
      prescriptionId: 'rx-1',
      medicineId: 'med-1',
      medicineName: 'Paracetamol',
      dosage: '500mg',
      frequency: 'BID',
      duration: '5 days',
      route: null,
      instructions: null,
      sortOrder: 0,
    },
  ],
};

function makeService(overrides?: Partial<Record<string, unknown>>) {
  const prisma = {
    prescription: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    prescriptionItem: {
      createMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    ...overrides,
  };
  (prisma as Record<string, unknown>).$transaction = jest.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(prisma);
  });

  const jwtService = {} as JwtService;
  const consultationsService = {
    findById: jest.fn().mockResolvedValue(consultationDto),
  } as unknown as ConsultationsService;
  const doctorsService = {
    findById: jest.fn().mockResolvedValue(doctorDto),
  } as unknown as DoctorsService;
  const patientsService = {
    findById: jest.fn().mockResolvedValue(patientDto),
  } as unknown as PatientsService;
  const medicinesService = {} as unknown as MedicinesService;
  const clinicsService = {} as unknown as ClinicsService;
  const notificationsService = {
    create: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationsService;
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new PrescriptionsService(
    prisma as unknown as PrismaService,
    jwtService,
    consultationsService,
    doctorsService,
    patientsService,
    medicinesService,
    clinicsService,
    notificationsService,
    auditService as unknown as AuditService,
  );

  return { service, prisma, auditService, notificationsService };
}

describe('PrescriptionsService', () => {
  describe('create', () => {
    it('records PRESCRIPTION_CREATED', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.prescription.findFirst.mockResolvedValue(null);
      prisma.prescription.create.mockResolvedValue(basePrescription);

      await service.create('clinic-a', 'user-doctor', { consultationId: 'consult-1' });

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: 'clinic-a',
          actorUserId: 'user-doctor',
          entity: 'Prescription',
          entityId: 'rx-1',
          action: 'prescription.created',
        }),
      );
    });

    it('rejects a second active prescription for the same consultation', async () => {
      const { service, prisma } = makeService();
      prisma.prescription.findFirst.mockResolvedValue({ ...basePrescription, status: 'DRAFT' });

      await expect(
        service.create('clinic-a', 'user-doctor', { consultationId: 'consult-1' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('view (PHI access)', () => {
    it('records PRESCRIPTION_VIEWED via findByIdAudited but not plain findById', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.prescription.findFirst.mockResolvedValue(basePrescription);

      await service.findById('clinic-a', 'rx-1');
      expect(auditService.record).not.toHaveBeenCalled();

      await service.findByIdAudited('clinic-a', 'rx-1', 'user-doctor');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'Prescription',
          entityId: 'rx-1',
          action: 'prescription.viewed',
          actorUserId: 'user-doctor',
        }),
      );
    });

    it('a cross-tenant prescription id 404s rather than leaking existence', async () => {
      const { service, prisma } = makeService();
      prisma.prescription.findFirst.mockResolvedValue(null);

      await expect(service.findById('clinic-b', 'rx-1')).rejects.toThrow(NotFoundException);
    });

    it("rejects a doctor viewing another doctor's prescription", async () => {
      const { service, prisma } = makeService();
      prisma.prescription.findFirst.mockResolvedValue(basePrescription);

      await expect(
        service.findById('clinic-a', 'rx-1', { doctorId: 'someone-else' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update (PHI modification)', () => {
    it('records PRESCRIPTION_UPDATED with field names only', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.prescription.findFirst.mockResolvedValue(basePrescription);
      prisma.prescription.update.mockResolvedValue({
        ...basePrescription,
        notes: 'take with food',
      });

      await service.update('clinic-a', 'rx-1', { notes: 'take with food' }, 'user-doctor');

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'Prescription',
          action: 'prescription.updated',
          changedFields: 'notes',
        }),
      );
    });

    it('rejects modifying a finalized prescription', async () => {
      const { service, prisma } = makeService();
      prisma.prescription.findFirst.mockResolvedValue({ ...basePrescription, status: 'FINALIZED' });

      await expect(
        service.update('clinic-a', 'rx-1', { notes: 'x' }, 'user-doctor'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('finalize', () => {
    it('records PRESCRIPTION_FINALIZED only after the transaction commits', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.prescription.findFirst.mockResolvedValue(basePrescription);

      await service.finalize('clinic-a', 'rx-1', 'user-doctor');

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'Prescription',
          entityId: 'rx-1',
          action: 'prescription.finalized',
          actorUserId: 'user-doctor',
        }),
      );
    });

    it('rejects finalizing a prescription with no items, and never records an audit event for it', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.prescription.findFirst.mockResolvedValue({ ...basePrescription, items: [] });

      await expect(service.finalize('clinic-a', 'rx-1', 'user-doctor')).rejects.toThrow(
        BadRequestException,
      );
      expect(auditService.record).not.toHaveBeenCalled();
    });
  });

  describe('amend', () => {
    it('records PRESCRIPTION_AMENDED referencing the original prescription id', async () => {
      const { service, prisma, auditService } = makeService();
      const finalized = { ...basePrescription, status: 'FINALIZED' };
      prisma.prescription.findFirst
        .mockResolvedValueOnce(finalized) // findActiveRowOrThrow
        .mockResolvedValueOnce(null) // no existing amendment
        .mockResolvedValueOnce({ ...finalized, id: 'rx-2', version: 2 }); // findById after amend
      prisma.prescription.create.mockResolvedValue({ ...finalized, id: 'rx-2', version: 2 });

      await service.amend('clinic-a', 'rx-1', 'user-doctor');

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'Prescription',
          entityId: 'rx-2',
          action: 'prescription.amended',
          changedFields: 'amendsId=rx-1',
        }),
      );
    });
  });

  describe('cross-tenant isolation', () => {
    it('scopes every lookup by clinicId', async () => {
      const { service, prisma } = makeService();
      prisma.prescription.findFirst.mockResolvedValue(null);

      await expect(service.findById('clinic-b', 'rx-1')).rejects.toThrow(NotFoundException);

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.prescription.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'rx-1', clinicId: 'clinic-b' }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('update() scopes the write itself by clinicId, not only the earlier read', async () => {
      const { service, prisma } = makeService();
      prisma.prescription.findFirst.mockResolvedValue(basePrescription);

      await service.update('clinic-a', 'rx-1', { notes: 'x' }, 'user-doctor');

      expect(prisma.prescription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rx-1', clinicId: 'clinic-a' } }),
      );
    });

    it('update() 404s instead of writing when updateMany matches no row (cross-tenant id reuse)', async () => {
      const { service, prisma } = makeService();
      prisma.prescription.findFirst.mockResolvedValue(basePrescription);
      prisma.prescription.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.update('clinic-a', 'rx-1', { notes: 'x' }, 'user-doctor'),
      ).rejects.toThrow(NotFoundException);
    });

    it("updateItem() scopes the write by the item's own prescriptionId, not just itemId", async () => {
      const { service, prisma } = makeService();
      prisma.prescription.findFirst.mockResolvedValue(basePrescription);

      await service.updateItem('clinic-a', 'rx-1', 'item-1', { dosage: '250mg' });

      expect(prisma.prescriptionItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'item-1', prescriptionId: 'rx-1' } }),
      );
    });

    it('updateItem() 404s when the item does not actually belong to this prescription', async () => {
      const { service, prisma } = makeService();
      prisma.prescription.findFirst.mockResolvedValue(basePrescription);
      prisma.prescriptionItem.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateItem('clinic-a', 'rx-1', 'item-from-another-prescription', {
          dosage: '250mg',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("removeItem() scopes the delete by the item's own prescriptionId", async () => {
      const { service, prisma } = makeService();
      prisma.prescription.findFirst.mockResolvedValue(basePrescription);

      await service.removeItem('clinic-a', 'rx-1', 'item-1');

      expect(prisma.prescriptionItem.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'item-1', prescriptionId: 'rx-1' } }),
      );
    });
  });
});
