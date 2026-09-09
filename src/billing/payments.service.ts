import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Invoice, Payment, Prisma, Refund } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ClinicsService } from '../clinics/clinics.service';
import { PrismaService } from '../prisma/prisma.service';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import { assertScopedWrite } from '../common/scoped-write.util';
import type { BillingDownloadTokenPayload } from './billing-download-token.interface';
import { renderReceiptPdf } from './billing-pdf.util';
import type { CreatePaymentDto } from './dto/create-payment.dto';
import type { CreateRefundDto } from './dto/create-refund.dto';
import type { PaymentResponseDto } from './dto/payment-response.dto';
import type { QueryPaymentsDto } from './dto/query-payments.dto';
import { InvoicesService, type BillingOwnershipScope } from './invoices.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './payment-providers/payment-provider.interface';

type PaymentWithRelations = Payment & { invoice: Invoice; refunds: Refund[] };

const DOWNLOAD_TOKEN_TTL_SECONDS = 300;

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly invoicesService: InvoicesService,
    private readonly clinicsService: ClinicsService,
    private readonly auditService: AuditService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  private get downloadTokenSecret(): string {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error('JWT_ACCESS_SECRET is not configured');
    return secret;
  }

  async create(
    clinicId: string,
    receivedByUserId: string,
    dto: CreatePaymentDto,
    scope?: BillingOwnershipScope,
  ): Promise<PaymentResponseDto> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: dto.invoiceId, clinicId, deletedAt: null },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (scope?.patientId && invoice.patientId !== scope.patientId) {
      throw new ForbiddenException('Not your invoice');
    }
    if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') {
      throw new ConflictException(
        `Cannot record a payment against an invoice with status ${invoice.status}`,
      );
    }

    const balanceDue = round2(Number(invoice.totalAmount) - Number(invoice.amountPaid));
    if (dto.amount > balanceDue) {
      throw new BadRequestException(
        `Payment amount exceeds the invoice balance due (${balanceDue.toFixed(2)})`,
      );
    }

    const captureResult = await this.paymentProvider.capture({
      amount: dto.amount,
      method: dto.method,
      reference: dto.reference,
    });
    if (captureResult.status === 'FAILED') {
      throw new BadRequestException('Payment capture failed');
    }

    const clinic = await this.prisma.clinic.update({
      where: { id: clinicId },
      data: { receiptSequence: { increment: 1 } },
    });
    const receiptNumber =
      captureResult.status === 'COMPLETED'
        ? `RCPT-${String(clinic.receiptSequence).padStart(6, '0')}`
        : null;

    const [created] = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          clinicId,
          invoiceId: dto.invoiceId,
          amount: dto.amount,
          method: dto.method,
          status: captureResult.status,
          providerReference: captureResult.providerReference,
          receiptNumber,
          receivedByUserId,
          paidAt: captureResult.status === 'COMPLETED' ? new Date() : undefined,
          notes: dto.notes,
        },
      });
      if (captureResult.status === 'COMPLETED') {
        await this.invoicesService.applyPaymentAmountDelta(tx, clinicId, dto.invoiceId, dto.amount);
      }
      return [payment];
    });

    await this.auditService.record({
      clinicId,
      actorUserId: receivedByUserId,
      entity: 'Payment',
      entityId: created.id,
      action: 'payment.recorded',
      changedFields: `invoiceId=${dto.invoiceId},amount=${dto.amount},method=${dto.method}`,
    });

    return this.findById(clinicId, created.id, scope);
  }

  async findAll(
    clinicId: string,
    query: QueryPaymentsDto,
    scope?: BillingOwnershipScope,
  ): Promise<PaginatedResult<PaymentResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.PaymentWhereInput = {
      clinicId,
      ...(query.invoiceId ? { invoiceId: query.invoiceId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.method ? { method: query.method } : {}),
      ...(scope?.patientId ? { invoice: { patientId: scope.patientId } } : {}),
    };

    const [total, payments] = await this.prisma.$transaction([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        include: { invoice: true, refunds: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { data: payments.map((p) => this.toResponseDto(p)), meta: { total, page, pageSize } };
  }

  async findOwnForPatient(
    clinicId: string,
    patientId: string,
    query: QueryPaymentsDto,
  ): Promise<PaginatedResult<PaymentResponseDto>> {
    return this.findAll(clinicId, query, { patientId });
  }

  async findById(
    clinicId: string,
    id: string,
    scope?: BillingOwnershipScope,
  ): Promise<PaymentResponseDto> {
    const row = await this.findActiveRowOrThrow(clinicId, id, scope);
    return this.toResponseDto(row);
  }

  async refund(
    clinicId: string,
    id: string,
    dto: CreateRefundDto,
    actorUserId: string,
    scope?: BillingOwnershipScope,
  ): Promise<PaymentResponseDto> {
    const row = await this.findActiveRowOrThrow(clinicId, id, scope);
    if (row.status !== 'COMPLETED' && row.status !== 'PARTIALLY_REFUNDED') {
      throw new ConflictException(`Cannot refund a payment with status ${row.status}`);
    }

    const alreadyRefunded = round2(row.refunds.reduce((sum, r) => sum + Number(r.amount), 0));
    const remaining = round2(Number(row.amount) - alreadyRefunded);
    if (dto.amount > remaining) {
      throw new BadRequestException(
        `Refund amount exceeds the payment's unrefunded balance (${remaining.toFixed(2)})`,
      );
    }

    const newStatus =
      round2(alreadyRefunded + dto.amount) >= Number(row.amount)
        ? 'REFUNDED'
        : 'PARTIALLY_REFUNDED';

    await this.prisma.$transaction(async (tx) => {
      await tx.refund.create({
        data: {
          clinicId,
          paymentId: id,
          amount: dto.amount,
          reason: dto.reason,
          status: 'COMPLETED',
          processedByUserId: actorUserId,
          processedAt: new Date(),
        },
      });
      const paymentUpdateResult = await tx.payment.updateMany({
        where: { id, clinicId },
        data: { status: newStatus },
      });
      assertScopedWrite(paymentUpdateResult, 'Payment not found');
      await this.invoicesService.applyPaymentAmountDelta(tx, clinicId, row.invoiceId, -dto.amount);
    });

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Payment',
      entityId: id,
      action: 'payment.refunded',
      changedFields: `amount=${dto.amount},reason`,
    });

    return this.findById(clinicId, id, scope);
  }

  async issueReceiptToken(
    clinicId: string,
    id: string,
    scope?: BillingOwnershipScope,
  ): Promise<{ token: string; expiresInSeconds: number }> {
    const row = await this.findActiveRowOrThrow(clinicId, id, scope);
    if (
      row.status !== 'COMPLETED' &&
      row.status !== 'PARTIALLY_REFUNDED' &&
      row.status !== 'REFUNDED'
    ) {
      throw new ForbiddenException('No receipt is available for a payment that never completed');
    }

    const payload: BillingDownloadTokenPayload = { purpose: 'receipt-pdf', id, clinicId };
    const token = this.jwtService.sign(payload, {
      secret: this.downloadTokenSecret,
      expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS,
    });
    return { token, expiresInSeconds: DOWNLOAD_TOKEN_TTL_SECONDS };
  }

  async generateReceiptPdfFromToken(
    id: string,
    token: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    let payload: BillingDownloadTokenPayload;
    try {
      payload = this.jwtService.verify<BillingDownloadTokenPayload>(token, {
        secret: this.downloadTokenSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired download link');
    }
    if (payload.purpose !== 'receipt-pdf' || payload.id !== id) {
      throw new UnauthorizedException('Invalid or expired download link');
    }

    const row = await this.prisma.payment.findFirst({
      where: { id: payload.id, clinicId: payload.clinicId },
      include: { invoice: true, refunds: true },
    });
    if (!row || row.status === 'PENDING' || row.status === 'FAILED') {
      throw new NotFoundException('Receipt not found');
    }

    const paymentDto = this.toResponseDto(row);
    const invoiceDto = await this.invoicesService.findById(payload.clinicId, row.invoiceId);
    const clinic = await this.clinicsService.getOwnClinic(payload.clinicId);
    const buffer = await renderReceiptPdf(paymentDto, invoiceDto, clinic.name);
    return { buffer, filename: `receipt-${row.receiptNumber ?? row.id}.pdf` };
  }

  private async findActiveRowOrThrow(
    clinicId: string,
    id: string,
    scope?: BillingOwnershipScope,
  ): Promise<PaymentWithRelations> {
    const row = await this.prisma.payment.findFirst({
      where: { id, clinicId },
      include: { invoice: true, refunds: true },
    });
    if (!row) throw new NotFoundException('Payment not found');
    if (scope?.patientId && row.invoice.patientId !== scope.patientId) {
      throw new ForbiddenException('Not your payment');
    }
    return row;
  }

  private toResponseDto(payment: PaymentWithRelations): PaymentResponseDto {
    return {
      id: payment.id,
      clinicId: payment.clinicId,
      invoiceId: payment.invoiceId,
      amount: payment.amount.toString(),
      method: payment.method as PaymentResponseDto['method'],
      status: payment.status as PaymentResponseDto['status'],
      providerReference: payment.providerReference,
      receiptNumber: payment.receiptNumber,
      receivedByUserId: payment.receivedByUserId,
      paidAt: payment.paidAt,
      notes: payment.notes,
      refunds: payment.refunds.map((r) => ({
        id: r.id,
        paymentId: r.paymentId,
        amount: r.amount.toString(),
        reason: r.reason,
        status: r.status as PaymentResponseDto['refunds'][number]['status'],
        processedByUserId: r.processedByUserId,
        processedAt: r.processedAt,
        createdAt: r.createdAt,
      })),
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }
}
