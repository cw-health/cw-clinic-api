import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { ClinicsService } from '../clinics/clinics.service';
import type { ConsultationsService } from '../consultations/consultations.service';
import type { DoctorsService } from '../doctors/doctors.service';
import type { PatientsService } from '../patients/patients.service';
import type { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from './invoices.service';

const doctorDto = { id: 'doctor-1', clinicId: 'clinic-a', firstName: 'Ada', lastName: 'Lovelace' };
const patientDto = {
  id: 'patient-1',
  clinicId: 'clinic-a',
  firstName: 'Grace',
  lastName: 'Hopper',
};
const consultationDto = {
  id: 'consult-1',
  clinicId: 'clinic-a',
  doctorId: 'doctor-1',
  patientId: 'patient-1',
};

const baseItem = {
  id: 'item-1',
  invoiceId: 'invoice-1',
  description: 'Consultation fee',
  itemType: 'CONSULTATION_FEE',
  quantity: 1,
  unitPrice: 500,
  discountAmount: 0,
  taxRatePercent: 0,
  lineTotal: 500,
  sortOrder: 0,
};

const baseInvoice = {
  id: 'invoice-1',
  clinicId: 'clinic-a',
  consultationId: 'consult-1',
  doctorId: 'doctor-1',
  patientId: 'patient-1',
  invoiceNumber: null,
  status: 'DRAFT',
  subtotal: 0,
  discountAmount: 0,
  taxAmount: 0,
  totalAmount: 0,
  amountPaid: 0,
  notes: null,
  createdByUserId: 'user-billing',
  issuedAt: null,
  dueDate: null,
  voidedAt: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [baseItem],
};

function makeService() {
  const prisma = {
    invoice: {
      findFirst: jest.fn().mockResolvedValue(baseInvoice),
      findFirstOrThrow: jest.fn().mockResolvedValue(baseInvoice),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(baseInvoice),
      update: jest.fn().mockResolvedValue(baseInvoice),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: 0 }, _count: 0 }),
    },
    invoiceItem: {
      create: jest.fn().mockResolvedValue(baseItem),
      update: jest.fn().mockResolvedValue(baseItem),
      delete: jest.fn().mockResolvedValue(baseItem),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    payment: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 }, _count: 0 }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    refund: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
    },
    clinic: {
      update: jest
        .fn()
        .mockResolvedValue({ id: 'clinic-a', invoiceSequence: 1, name: 'Test Clinic' }),
    },
  } as unknown as Record<string, unknown>;
  prisma.$transaction = jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(prisma);
    return Promise.all(arg as Promise<unknown>[]);
  });

  const consultationsService = { findById: jest.fn().mockResolvedValue(consultationDto) };
  const doctorsService = { findById: jest.fn().mockResolvedValue(doctorDto) };
  const patientsService = { findById: jest.fn().mockResolvedValue(patientDto) };
  const clinicsService = {
    getOwnClinic: jest.fn().mockResolvedValue({ id: 'clinic-a', name: 'Test Clinic' }),
  };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const jwtService = { sign: jest.fn().mockReturnValue('token'), verify: jest.fn() };

  const service = new InvoicesService(
    prisma as unknown as PrismaService,
    jwtService as never,
    consultationsService as unknown as ConsultationsService,
    doctorsService as unknown as DoctorsService,
    patientsService as unknown as PatientsService,
    clinicsService as unknown as ClinicsService,
    auditService as unknown as AuditService,
  );

  return {
    service,
    prisma,
    consultationsService,
    doctorsService,
    patientsService,
    clinicsService,
    auditService,
  };
}

describe('InvoicesService', () => {
  describe('create', () => {
    it('computes each line item total and records an invoice.created audit event', async () => {
      const { service, prisma, auditService } = makeService();
      (prisma.invoice as { findFirst: jest.Mock }).findFirst.mockResolvedValue(null);

      await service.create('clinic-a', 'user-billing', {
        consultationId: 'consult-1',
        items: [{ description: 'Consultation fee', unitPrice: 500, quantity: 1 }],
      });

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect((prisma.invoice as { create: jest.Mock }).create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            items: { create: [expect.objectContaining({ lineTotal: 500 })] },
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'Invoice', action: 'invoice.created' }),
      );
    });

    it('applies discount and tax to the line total', async () => {
      const { service, prisma } = makeService();
      (prisma.invoice as { findFirst: jest.Mock }).findFirst.mockResolvedValue(null);

      await service.create('clinic-a', 'user-billing', {
        consultationId: 'consult-1',
        items: [
          {
            description: 'Consultation fee',
            unitPrice: 500,
            quantity: 2,
            discountAmount: 100,
            taxRatePercent: 10,
          },
        ],
      });

      // (2 * 500 - 100) * 1.10 = 990
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect((prisma.invoice as { create: jest.Mock }).create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            items: { create: [expect.objectContaining({ lineTotal: 990 })] },
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('accepts the full chargeable-service vocabulary — consultation, procedure, lab, radiology, pharmacy, room, nursing, other', async () => {
      const { service, prisma } = makeService();
      (prisma.invoice as { findFirst: jest.Mock }).findFirst.mockResolvedValue(null);

      const itemTypes = [
        'CONSULTATION',
        'PROCEDURE',
        'LABORATORY',
        'RADIOLOGY',
        'PHARMACY',
        'ROOM',
        'NURSING',
        'OTHER',
      ] as const;

      await service.create('clinic-a', 'user-billing', {
        consultationId: 'consult-1',
        items: itemTypes.map((itemType) => ({
          description: itemType,
          itemType,
          unitPrice: 100,
        })),
      });

      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return -- test mock, loosely typed by design */
      expect((prisma.invoice as { create: jest.Mock }).create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            items: {
              create: itemTypes.map((itemType) => expect.objectContaining({ itemType })),
            },
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
    });

    it('rejects a second active invoice for the same consultation', async () => {
      const { service } = makeService();

      await expect(
        service.create('clinic-a', 'user-billing', {
          consultationId: 'consult-1',
          items: [{ description: 'Consultation fee', unitPrice: 500 }],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("rejects a patient creating an invoice for another patient's consultation", async () => {
      const { service, prisma } = makeService();
      (prisma.invoice as { findFirst: jest.Mock }).findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          'clinic-a',
          'user-billing',
          { consultationId: 'consult-1', items: [{ description: 'Fee', unitPrice: 500 }] },
          { patientId: 'someone-else' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('issue', () => {
    it('computes totals, assigns an invoice number, and records invoice.issued', async () => {
      const { service, prisma, auditService } = makeService();

      await service.issue('clinic-a', 'invoice-1', 'user-billing');

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect((prisma.invoice as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'invoice-1', clinicId: 'clinic-a' },
          data: expect.objectContaining({
            status: 'ISSUED',
            invoiceNumber: 'INV-000001',
            subtotal: 500,
            totalAmount: 500,
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'invoice.issued' }),
      );
    });

    it('rejects issuing an invoice with no items', async () => {
      const { service, prisma } = makeService();
      (prisma.invoice as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...baseInvoice,
        items: [],
      });

      await expect(service.issue('clinic-a', 'invoice-1', 'user-billing')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects issuing an already-issued invoice', async () => {
      const { service, prisma } = makeService();
      (prisma.invoice as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...baseInvoice,
        status: 'ISSUED',
      });

      await expect(service.issue('clinic-a', 'invoice-1', 'user-billing')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('addItem / updateItem / removeItem', () => {
    it('rejects adding an item to a non-draft invoice', async () => {
      const { service, prisma } = makeService();
      (prisma.invoice as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...baseInvoice,
        status: 'ISSUED',
      });

      await expect(
        service.addItem('clinic-a', 'invoice-1', { description: 'X', unitPrice: 10 }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('void', () => {
    it('rejects voiding an invoice that has payments', async () => {
      const { service, prisma } = makeService();
      (prisma.invoice as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...baseInvoice,
        status: 'ISSUED',
        amountPaid: 100,
      });

      await expect(service.void('clinic-a', 'invoice-1', 'user-billing')).rejects.toThrow(
        ConflictException,
      );
    });

    it('voids an unpaid issued invoice and records invoice.modified', async () => {
      const { service, prisma, auditService } = makeService();
      (prisma.invoice as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...baseInvoice,
        status: 'ISSUED',
        amountPaid: 0,
      });

      await service.void('clinic-a', 'invoice-1', 'user-billing');

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect((prisma.invoice as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'invoice-1', clinicId: 'clinic-a' },
          data: expect.objectContaining({ status: 'VOID' }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'invoice.modified' }),
      );
    });
  });

  describe('cross-tenant isolation on writes', () => {
    it("updateItem() scopes the write by the item's own invoiceId, not just itemId", async () => {
      const { service, prisma } = makeService();

      await service.updateItem('clinic-a', 'invoice-1', 'item-1', { unitPrice: 600 });

      expect((prisma.invoiceItem as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'item-1', invoiceId: 'invoice-1' } }),
      );
    });

    it('updateItem() 404s when updateMany matches no row (item does not actually belong to this invoice)', async () => {
      const { service, prisma } = makeService();
      (prisma.invoiceItem as { updateMany: jest.Mock }).updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateItem('clinic-a', 'invoice-1', 'item-1', { unitPrice: 600 }),
      ).rejects.toThrow(NotFoundException);
    });

    it("removeItem() scopes the delete by the item's own invoiceId", async () => {
      const { service, prisma } = makeService();

      await service.removeItem('clinic-a', 'invoice-1', 'item-1');

      expect((prisma.invoiceItem as { deleteMany: jest.Mock }).deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'item-1', invoiceId: 'invoice-1' } }),
      );
    });

    it('update() 404s instead of writing when updateMany matches no row (cross-tenant id reuse)', async () => {
      const { service, prisma } = makeService();
      (prisma.invoice as { updateMany: jest.Mock }).updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.update('clinic-a', 'invoice-1', { notes: 'x' }, 'user-billing'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('charge-type vocabulary widening — historical data preserved', () => {
    it('reads back a pre-existing item written under the old itemType vocabulary unchanged', async () => {
      // baseItem carries the pre-widening value 'CONSULTATION_FEE' — the
      // widened INVOICE_ITEM_TYPES no longer offers it on write, but
      // nothing here rewrites or rejects the historical row on read.
      const { service } = makeService();

      const invoice = await service.findById('clinic-a', 'invoice-1');

      expect(invoice.items[0].itemType).toBe('CONSULTATION_FEE');
    });

    it('does not populate prescriptionId/investigationOrderId on a newly created item — schema-only prep, unused', async () => {
      const { service, prisma } = makeService();
      (prisma.invoice as { findFirst: jest.Mock }).findFirst.mockResolvedValue(null);

      await service.create('clinic-a', 'user-billing', {
        consultationId: 'consult-1',
        items: [{ description: 'Lab panel', itemType: 'LABORATORY', unitPrice: 100 }],
      });

      const calls = (prisma.invoice as { create: jest.Mock }).create.mock.calls as unknown[][];
      const createCall = calls[0][0] as {
        data: { items: { create: Array<Record<string, unknown>> } };
      };

      expect(createCall.data.items.create[0]).not.toHaveProperty('prescriptionId');
      expect(createCall.data.items.create[0]).not.toHaveProperty('investigationOrderId');
    });
  });

  describe('tenant isolation & ownership', () => {
    it('a cross-tenant invoice id 404s rather than leaking existence', async () => {
      const { service, prisma } = makeService();
      (prisma.invoice as { findFirst: jest.Mock }).findFirst.mockResolvedValue(null);

      await expect(service.findById('clinic-b', 'invoice-1')).rejects.toThrow(NotFoundException);
    });

    it("rejects a patient reading another patient's invoice", async () => {
      const { service } = makeService();

      await expect(
        service.findById('clinic-a', 'invoice-1', { patientId: 'someone-else' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('hides a DRAFT invoice from patient self-service', async () => {
      const { service } = makeService();

      await expect(
        service.findById('clinic-a', 'invoice-1', { patientId: 'patient-1' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
