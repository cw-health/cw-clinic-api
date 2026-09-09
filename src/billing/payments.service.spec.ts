import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { ClinicsService } from '../clinics/clinics.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { InvoicesService } from './invoices.service';
import type { PaymentProvider } from './payment-providers/payment-provider.interface';
import { PaymentsService } from './payments.service';

const baseInvoice = {
  id: 'invoice-1',
  clinicId: 'clinic-a',
  patientId: 'patient-1',
  status: 'ISSUED',
  totalAmount: 500,
  amountPaid: 0,
};

const basePayment = {
  id: 'payment-1',
  clinicId: 'clinic-a',
  invoiceId: 'invoice-1',
  amount: 500,
  method: 'CASH',
  status: 'COMPLETED',
  providerReference: null,
  receiptNumber: 'RCPT-000001',
  receivedByUserId: 'user-billing',
  paidAt: new Date(),
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  invoice: baseInvoice,
  refunds: [] as { amount: number }[],
};

function makeService() {
  const prisma = {
    invoice: {
      findFirst: jest.fn().mockResolvedValue(baseInvoice),
    },
    payment: {
      findFirst: jest.fn().mockResolvedValue(basePayment),
      create: jest.fn().mockResolvedValue(basePayment),
      update: jest.fn().mockResolvedValue(basePayment),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    refund: {
      create: jest.fn().mockResolvedValue({ id: 'refund-1' }),
    },
    clinic: {
      update: jest
        .fn()
        .mockResolvedValue({ id: 'clinic-a', receiptSequence: 1, name: 'Test Clinic' }),
    },
  } as unknown as Record<string, unknown>;
  prisma.$transaction = jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(prisma);
    return Promise.all(arg as Promise<unknown>[]);
  });

  const invoicesService = {
    applyPaymentAmountDelta: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn().mockResolvedValue({ id: 'invoice-1', invoiceNumber: 'INV-000001' }),
  };
  const clinicsService = {
    getOwnClinic: jest.fn().mockResolvedValue({ id: 'clinic-a', name: 'Test Clinic' }),
  };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const jwtService = { sign: jest.fn().mockReturnValue('token'), verify: jest.fn() };
  const paymentProvider: PaymentProvider = {
    capture: jest.fn().mockResolvedValue({ status: 'COMPLETED', providerReference: undefined }),
  };

  const service = new PaymentsService(
    prisma as unknown as PrismaService,
    jwtService as never,
    invoicesService as unknown as InvoicesService,
    clinicsService as unknown as ClinicsService,
    auditService as unknown as AuditService,
    paymentProvider,
  );

  return { service, prisma, invoicesService, clinicsService, auditService, paymentProvider };
}

describe('PaymentsService', () => {
  describe('create', () => {
    it('captures via the PaymentProvider, applies the amount to the invoice, and records payment.recorded', async () => {
      const { service, invoicesService, auditService, paymentProvider } = makeService();

      await service.create('clinic-a', 'user-billing', {
        invoiceId: 'invoice-1',
        amount: 500,
        method: 'CASH',
      });

      // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock reference, not a real bound method
      expect(paymentProvider.capture).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 500, method: 'CASH' }),
      );
      expect(invoicesService.applyPaymentAmountDelta).toHaveBeenCalledWith(
        expect.anything(),
        'clinic-a',
        'invoice-1',
        500,
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'Payment', action: 'payment.recorded' }),
      );
    });

    it('rejects a payment against a DRAFT invoice', async () => {
      const { service, prisma } = makeService();
      (prisma.invoice as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...baseInvoice,
        status: 'DRAFT',
      });

      await expect(
        service.create('clinic-a', 'user-billing', {
          invoiceId: 'invoice-1',
          amount: 500,
          method: 'CASH',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a payment that exceeds the invoice balance due', async () => {
      const { service, prisma } = makeService();
      (prisma.invoice as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...baseInvoice,
        amountPaid: 400,
      });

      await expect(
        service.create('clinic-a', 'user-billing', {
          invoiceId: 'invoice-1',
          amount: 200,
          method: 'CASH',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects a patient paying against another patient's invoice", async () => {
      const { service } = makeService();

      await expect(
        service.create(
          'clinic-a',
          'user-billing',
          { invoiceId: 'invoice-1', amount: 500, method: 'CASH' },
          { patientId: 'someone-else' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('a cross-tenant invoice id 404s rather than leaking existence', async () => {
      const { service, prisma } = makeService();
      (prisma.invoice as { findFirst: jest.Mock }).findFirst.mockResolvedValue(null);

      await expect(
        service.create('clinic-b', 'user-billing', {
          invoiceId: 'invoice-1',
          amount: 500,
          method: 'CASH',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('refund', () => {
    it('fully refunds a payment and decrements the invoice by the refund amount', async () => {
      const { service, prisma, invoicesService, auditService } = makeService();

      await service.refund(
        'clinic-a',
        'payment-1',
        { amount: 500, reason: 'Duplicate charge' },
        'user-billing',
      );

      expect((prisma.payment as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'payment-1', clinicId: 'clinic-a' },
          data: { status: 'REFUNDED' },
        }),
      );

      expect(invoicesService.applyPaymentAmountDelta).toHaveBeenCalledWith(
        expect.anything(),
        'clinic-a',
        'invoice-1',
        -500,
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'Payment', action: 'payment.refunded' }),
      );
    });

    it('partially refunds and marks the payment PARTIALLY_REFUNDED', async () => {
      const { service, prisma } = makeService();

      await service.refund(
        'clinic-a',
        'payment-1',
        { amount: 200, reason: 'Goodwill' },
        'user-billing',
      );

      expect((prisma.payment as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'PARTIALLY_REFUNDED' } }),
      );
    });

    it('rejects a refund exceeding the unrefunded balance', async () => {
      const { service, prisma } = makeService();
      (prisma.payment as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...basePayment,
        refunds: [{ amount: 400 }],
      });

      await expect(
        service.refund(
          'clinic-a',
          'payment-1',
          { amount: 200, reason: 'Too much' },
          'user-billing',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects refunding a payment that never completed', async () => {
      const { service, prisma } = makeService();
      (prisma.payment as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...basePayment,
        status: 'PENDING',
      });

      await expect(
        service.refund('clinic-a', 'payment-1', { amount: 100, reason: 'X' }, 'user-billing'),
      ).rejects.toThrow(ConflictException);
    });
  });
});
