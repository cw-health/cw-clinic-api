import { BadRequestException, ConflictException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { BranchesService } from '../branches/branches.service';
import type { MedicinesService } from '../medicines/medicines.service';
import type { PatientsService } from '../patients/patients.service';
import type { PrescriptionsService } from '../prescriptions/prescriptions.service';
import type { PrismaService } from '../prisma/prisma.service';
import { DispensingService } from './dispensing.service';

const soonBatch = {
  id: 'batch-soon',
  clinicId: 'clinic-a',
  branchId: null,
  medicineId: 'medicine-1',
  batchNumber: 'B-SOON',
  expiryDate: new Date('2027-01-01'),
  quantityOnHand: 5,
  sellingPrice: 10,
};

const laterBatch = {
  id: 'batch-later',
  clinicId: 'clinic-a',
  branchId: null,
  medicineId: 'medicine-1',
  batchNumber: 'B-LATER',
  expiryDate: new Date('2027-06-01'),
  quantityOnHand: 20,
  sellingPrice: 12,
};

const baseDispense = {
  id: 'dispense-1',
  clinicId: 'clinic-a',
  branchId: null,
  patientId: 'patient-1',
  prescriptionId: null,
  status: 'COMPLETED',
  dispensedByUserId: 'user-pharmacist',
  dispensedAt: new Date(),
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [] as unknown[],
};

function makeService(batches = [soonBatch, laterBatch]) {
  const prisma = {
    medicineBatch: {
      findMany: jest.fn().mockResolvedValue(batches),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    pharmacyDispense: {
      create: jest.fn().mockResolvedValue(baseDispense),
      findFirst: jest.fn().mockResolvedValue(baseDispense),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    pharmacyDispenseItem: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'dispense-item-1', ...data }),
        ),
    },
    stockMovement: {
      create: jest.fn().mockResolvedValue({ id: 'movement-1' }),
    },
    $transaction: undefined as unknown as (arg: unknown) => Promise<unknown>,
  };
  prisma.$transaction = jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(prisma);
    return Promise.all(arg as Promise<unknown>[]);
  });

  const patientsService = { findById: jest.fn().mockResolvedValue({ id: 'patient-1' }) };
  const prescriptionsService = {
    findById: jest.fn().mockResolvedValue({
      id: 'prescription-1',
      patientId: 'patient-1',
      status: 'FINALIZED',
      items: [{ id: 'rx-item-1' }],
    }),
  };
  const medicinesService = {
    findByIdForReference: jest.fn().mockResolvedValue({ id: 'medicine-1', name: 'Paracetamol' }),
  };
  const branchesService = { findById: jest.fn().mockResolvedValue({ id: 'branch-1' }) };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new DispensingService(
    prisma as unknown as PrismaService,
    patientsService as unknown as PatientsService,
    prescriptionsService as unknown as PrescriptionsService,
    medicinesService as unknown as MedicinesService,
    branchesService as unknown as BranchesService,
    auditService as unknown as AuditService,
  );

  return { service, prisma, patientsService, prescriptionsService, medicinesService, auditService };
}

describe('DispensingService', () => {
  describe('create', () => {
    it('allocates FEFO across batches and writes one DISPENSE movement per batch consumed', async () => {
      const { service, prisma } = makeService();

      await service.create('clinic-a', 'user-pharmacist', {
        patientId: 'patient-1',
        items: [{ medicineId: 'medicine-1', quantity: 8 }],
      });

      // 5 from the sooner-expiry batch, then 3 from the later one.
      expect(prisma.medicineBatch.updateMany).toHaveBeenCalledWith({
        where: { id: 'batch-soon', clinicId: 'clinic-a' },
        data: { quantityOnHand: { decrement: 5 } },
      });
      expect(prisma.medicineBatch.updateMany).toHaveBeenCalledWith({
        where: { id: 'batch-later', clinicId: 'clinic-a' },
        data: { quantityOnHand: { decrement: 3 } },
      });
      expect(prisma.stockMovement.create).toHaveBeenCalledTimes(2);
    });

    it('rejects when total available stock is short of the requested quantity', async () => {
      const { service } = makeService([{ ...soonBatch, quantityOnHand: 2 }]);

      await expect(
        service.create('clinic-a', 'user-pharmacist', {
          patientId: 'patient-1',
          items: [{ medicineId: 'medicine-1', quantity: 8 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects dispensing against a prescription that is not FINALIZED', async () => {
      const { service, prescriptionsService } = makeService();
      prescriptionsService.findById = jest.fn().mockResolvedValue({
        id: 'prescription-1',
        patientId: 'patient-1',
        status: 'DRAFT',
        items: [],
      });

      await expect(
        service.create('clinic-a', 'user-pharmacist', {
          patientId: 'patient-1',
          prescriptionId: 'prescription-1',
          items: [{ medicineId: 'medicine-1', quantity: 1 }],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a prescriptionItemId that does not belong to the given prescription', async () => {
      const { service } = makeService();

      await expect(
        service.create('clinic-a', 'user-pharmacist', {
          patientId: 'patient-1',
          prescriptionId: 'prescription-1',
          items: [{ medicineId: 'medicine-1', quantity: 1, prescriptionItemId: 'not-on-this-rx' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
