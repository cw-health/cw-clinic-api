import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Invoice, InvoiceItem, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ClinicsService } from '../clinics/clinics.service';
import { ConsultationsService } from '../consultations/consultations.service';
import { DoctorsService } from '../doctors/doctors.service';
import { PatientsService } from '../patients/patients.service';
import { PrismaService } from '../prisma/prisma.service';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import { assertScopedWrite } from '../common/scoped-write.util';
import type { BillingDownloadTokenPayload } from './billing-download-token.interface';
import { renderInvoicePdf } from './billing-pdf.util';
import type { CreateInvoiceItemDto } from './dto/create-invoice-item.dto';
import type { CreateInvoiceDto } from './dto/create-invoice.dto';
import type { InvoiceResponseDto } from './dto/invoice-response.dto';
import type { QueryInvoicesDto } from './dto/query-invoices.dto';
import type { UpdateInvoiceItemDto } from './dto/update-invoice-item.dto';
import type { UpdateInvoiceDto } from './dto/update-invoice.dto';
import type {
  RevenueByMethod,
  RevenueSummaryQueryDto,
  RevenueSummaryResponseDto,
} from './dto/revenue-summary.dto';

/** Undefined means no restriction — mirrors PrescriptionOwnershipScope, one axis narrower (no doctor scope: billing staff aren't doctor-scoped). */
export interface BillingOwnershipScope {
  patientId?: string;
}

type InvoiceWithItems = Invoice & { items: InvoiceItem[] };

const DOWNLOAD_TOKEN_TTL_SECONDS = 300;
const ACTIVE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID'] as const;

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function computeLineTotal(
  quantity: number,
  unitPrice: number,
  discountAmount: number,
  taxRatePercent: number,
): number {
  const base = quantity * unitPrice - discountAmount;
  return round2(base * (1 + taxRatePercent / 100));
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly consultationsService: ConsultationsService,
    private readonly doctorsService: DoctorsService,
    private readonly patientsService: PatientsService,
    private readonly clinicsService: ClinicsService,
    private readonly auditService: AuditService,
  ) {}

  private get downloadTokenSecret(): string {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error('JWT_ACCESS_SECRET is not configured');
    return secret;
  }

  async create(
    clinicId: string,
    createdByUserId: string,
    dto: CreateInvoiceDto,
    scope?: BillingOwnershipScope,
  ): Promise<InvoiceResponseDto> {
    const consultation = await this.consultationsService.findById(clinicId, dto.consultationId);
    if (scope?.patientId && consultation.patientId !== scope.patientId) {
      throw new ForbiddenException('Not your consultation');
    }

    const existingActive = await this.prisma.invoice.findFirst({
      where: {
        clinicId,
        consultationId: dto.consultationId,
        deletedAt: null,
        status: { in: [...ACTIVE_STATUSES] },
      },
    });
    if (existingActive) {
      throw new ConflictException('An active invoice already exists for this consultation');
    }

    const created = await this.prisma.invoice.create({
      data: {
        clinicId,
        consultationId: dto.consultationId,
        doctorId: consultation.doctorId,
        patientId: consultation.patientId,
        notes: dto.notes,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        createdByUserId,
        items: { create: dto.items.map((item, index) => this.buildItemData(item, index)) },
      },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });

    await this.auditService.record({
      clinicId,
      actorUserId: createdByUserId,
      entity: 'Invoice',
      entityId: created.id,
      action: 'invoice.created',
      changedFields: `consultationId,items(${dto.items.length})`,
    });

    return this.toResponseDto(clinicId, created);
  }

  async findAll(
    clinicId: string,
    query: QueryInvoicesDto,
    scope?: BillingOwnershipScope,
  ): Promise<PaginatedResult<InvoiceResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.InvoiceWhereInput = {
      clinicId,
      deletedAt: null,
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.doctorId ? { doctorId: query.doctorId } : {}),
      ...(query.consultationId ? { consultationId: query.consultationId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.pendingOnly ? { status: { in: ['ISSUED', 'PARTIALLY_PAID'] } } : {}),
      ...(scope?.patientId ? { patientId: scope.patientId } : {}),
    };

    const [total, invoices] = await this.prisma.$transaction([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        include: { items: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const data = await Promise.all(invoices.map((i) => this.toResponseDto(clinicId, i)));
    return { data, meta: { total, page, pageSize } };
  }

  /** Patient self-service history — DRAFT invoices (not yet issued) are never visible here. */
  async findOwnForPatient(
    clinicId: string,
    patientId: string,
    query: QueryInvoicesDto,
  ): Promise<PaginatedResult<InvoiceResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.InvoiceWhereInput = {
      clinicId,
      patientId,
      deletedAt: null,
      status: { not: 'DRAFT' },
      ...(query.consultationId ? { consultationId: query.consultationId } : {}),
    };

    const [total, invoices] = await this.prisma.$transaction([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        include: { items: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const data = await Promise.all(invoices.map((i) => this.toResponseDto(clinicId, i)));
    return { data, meta: { total, page, pageSize } };
  }

  async findById(
    clinicId: string,
    id: string,
    scope?: BillingOwnershipScope,
  ): Promise<InvoiceResponseDto> {
    const row = await this.findActiveRowOrThrow(clinicId, id, scope);
    return this.toResponseDto(clinicId, row);
  }

  async update(
    clinicId: string,
    id: string,
    dto: UpdateInvoiceDto,
    actorUserId: string,
    scope?: BillingOwnershipScope,
  ): Promise<InvoiceResponseDto> {
    const row = await this.findActiveRowOrThrow(clinicId, id, scope);
    if (row.status === 'VOID') {
      throw new ConflictException('Cannot modify a voided invoice');
    }

    // Scoped at the query level, not only by the findActiveRowOrThrow check
    // above — see scoped-write.util.ts.
    const updateResult = await this.prisma.invoice.updateMany({
      where: { id, clinicId },
      data: {
        notes: dto.notes,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });
    assertScopedWrite(updateResult, 'Invoice not found');

    if (row.status !== 'DRAFT') {
      await this.auditService.record({
        clinicId,
        actorUserId,
        entity: 'Invoice',
        entityId: id,
        action: 'invoice.modified',
        changedFields: Object.keys(dto).join(','),
      });
    }

    return this.findById(clinicId, id, scope);
  }

  async addItem(
    clinicId: string,
    id: string,
    dto: CreateInvoiceItemDto,
    scope?: BillingOwnershipScope,
  ): Promise<InvoiceResponseDto> {
    const row = await this.findActiveRowOrThrow(clinicId, id, scope);
    this.assertDraft(row);

    await this.prisma.invoiceItem.create({
      data: { invoiceId: id, ...this.buildItemData(dto, row.items.length) },
    });
    return this.findById(clinicId, id, scope);
  }

  async updateItem(
    clinicId: string,
    id: string,
    itemId: string,
    dto: UpdateInvoiceItemDto,
    scope?: BillingOwnershipScope,
  ): Promise<InvoiceResponseDto> {
    const row = await this.findActiveRowOrThrow(clinicId, id, scope);
    this.assertDraft(row);
    const item = row.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Invoice item not found');

    const quantity = dto.quantity ?? item.quantity;
    const unitPrice = dto.unitPrice ?? Number(item.unitPrice);
    const discountAmount = dto.discountAmount ?? Number(item.discountAmount);
    const taxRatePercent = dto.taxRatePercent ?? Number(item.taxRatePercent);

    // InvoiceItem has no clinicId column of its own (it's a child of a
    // child) — `invoiceId: id` folds the parent id, already verified above
    // to belong to this clinic, into the write's own where clause rather
    // than trusting the `row.items.find` check alone (scoped-write.util.ts).
    const result = await this.prisma.invoiceItem.updateMany({
      where: { id: itemId, invoiceId: id },
      data: {
        description: dto.description,
        itemType: dto.itemType,
        quantity,
        unitPrice,
        discountAmount,
        taxRatePercent,
        lineTotal: computeLineTotal(quantity, unitPrice, discountAmount, taxRatePercent),
      },
    });
    assertScopedWrite(result, 'Invoice item not found');
    return this.findById(clinicId, id, scope);
  }

  async removeItem(
    clinicId: string,
    id: string,
    itemId: string,
    scope?: BillingOwnershipScope,
  ): Promise<InvoiceResponseDto> {
    const row = await this.findActiveRowOrThrow(clinicId, id, scope);
    this.assertDraft(row);
    const item = row.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Invoice item not found');

    const result = await this.prisma.invoiceItem.deleteMany({
      where: { id: itemId, invoiceId: id },
    });
    assertScopedWrite(result, 'Invoice item not found');
    return this.findById(clinicId, id, scope);
  }

  /** DRAFT -> ISSUED: locks items, computes totals, assigns the human-facing invoiceNumber. */
  async issue(
    clinicId: string,
    id: string,
    actorUserId: string,
    scope?: BillingOwnershipScope,
  ): Promise<InvoiceResponseDto> {
    const row = await this.findActiveRowOrThrow(clinicId, id, scope);
    this.assertDraft(row);
    if (row.items.length === 0) {
      throw new BadRequestException('Cannot issue an invoice with no items');
    }

    const subtotal = round2(
      row.items.reduce((sum, i) => sum + i.quantity * Number(i.unitPrice), 0),
    );
    const discountAmount = round2(row.items.reduce((sum, i) => sum + Number(i.discountAmount), 0));
    const totalAmount = round2(row.items.reduce((sum, i) => sum + Number(i.lineTotal), 0));
    const taxAmount = round2(totalAmount - subtotal + discountAmount);

    const clinic = await this.prisma.clinic.update({
      where: { id: clinicId },
      data: { invoiceSequence: { increment: 1 } },
    });
    const invoiceNumber = `INV-${String(clinic.invoiceSequence).padStart(6, '0')}`;

    const issueResult = await this.prisma.invoice.updateMany({
      where: { id, clinicId },
      data: {
        status: 'ISSUED',
        invoiceNumber,
        subtotal,
        discountAmount,
        taxAmount,
        totalAmount,
        issuedAt: new Date(),
      },
    });
    assertScopedWrite(issueResult, 'Invoice not found');

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Invoice',
      entityId: id,
      action: 'invoice.issued',
      changedFields: `status,invoiceNumber,totalAmount=${totalAmount}`,
    });

    return this.findById(clinicId, id, scope);
  }

  /** ISSUED/PARTIALLY_PAID -> VOID. Only while unpaid — void a paid invoice via refund instead. */
  async void(
    clinicId: string,
    id: string,
    actorUserId: string,
    scope?: BillingOwnershipScope,
  ): Promise<InvoiceResponseDto> {
    const row = await this.findActiveRowOrThrow(clinicId, id, scope);
    if (row.status === 'DRAFT' || row.status === 'VOID') {
      throw new ConflictException(`Cannot void an invoice with status ${row.status}`);
    }
    if (Number(row.amountPaid) > 0) {
      throw new ConflictException(
        'Cannot void an invoice with payments — refund the payments instead',
      );
    }

    const voidResult = await this.prisma.invoice.updateMany({
      where: { id, clinicId },
      data: { status: 'VOID', voidedAt: new Date() },
    });
    assertScopedWrite(voidResult, 'Invoice not found');

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Invoice',
      entityId: id,
      action: 'invoice.modified',
      changedFields: 'status=VOID',
    });

    return this.findById(clinicId, id, scope);
  }

  async issueDownloadToken(
    clinicId: string,
    id: string,
    scope?: BillingOwnershipScope,
  ): Promise<{ token: string; expiresInSeconds: number }> {
    const row = await this.findActiveRowOrThrow(clinicId, id, scope);
    if (row.status === 'DRAFT') {
      throw new ForbiddenException('Cannot download a draft invoice');
    }

    const payload: BillingDownloadTokenPayload = { purpose: 'invoice-pdf', id, clinicId };
    const token = this.jwtService.sign(payload, {
      secret: this.downloadTokenSecret,
      expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS,
    });
    return { token, expiresInSeconds: DOWNLOAD_TOKEN_TTL_SECONDS };
  }

  async generatePdfFromToken(
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
    if (payload.purpose !== 'invoice-pdf' || payload.id !== id) {
      throw new UnauthorizedException('Invalid or expired download link');
    }

    const row = await this.prisma.invoice.findFirst({
      where: { id: payload.id, clinicId: payload.clinicId, deletedAt: null },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!row || row.status === 'DRAFT') {
      throw new NotFoundException('Invoice not found');
    }

    const dto = await this.toResponseDto(payload.clinicId, row);
    const clinic = await this.clinicsService.getOwnClinic(payload.clinicId);
    const buffer = await renderInvoicePdf(dto, clinic.name);
    return { buffer, filename: `invoice-${row.invoiceNumber ?? row.id}.pdf` };
  }

  /**
   * Applies a delta to Invoice.amountPaid and recomputes status —
   * called by PaymentsService inside the same $transaction as the Payment/
   * Refund write it accompanies (positive delta on a completed payment,
   * negative on a refund). Not exposed over HTTP.
   */
  async applyPaymentAmountDelta(
    tx: Prisma.TransactionClient,
    clinicId: string,
    invoiceId: string,
    amountPaidDelta: number,
  ): Promise<void> {
    const invoice = await tx.invoice.findFirstOrThrow({ where: { id: invoiceId, clinicId } });
    const newAmountPaid = Math.min(
      Math.max(round2(Number(invoice.amountPaid) + amountPaidDelta), 0),
      Number(invoice.totalAmount),
    );
    const status =
      newAmountPaid <= 0
        ? 'ISSUED'
        : newAmountPaid >= Number(invoice.totalAmount)
          ? 'PAID'
          : 'PARTIALLY_PAID';
    // Scoped by clinicId, not just invoiceId — invoiceId is already caller-
    // verified in every call site (PaymentsService.create/refund), but this
    // keeps the write itself tenant-safe independent of that (scoped-write.util.ts).
    const result = await tx.invoice.updateMany({
      where: { id: invoiceId, clinicId },
      data: { amountPaid: newAmountPaid, status },
    });
    assertScopedWrite(result, 'Invoice not found');
  }

  /** Basic aggregate revenue reporting (task brief) — the full `reports` module stays Phase 7/out of scope. */
  async revenueSummary(
    clinicId: string,
    query: RevenueSummaryQueryDto,
  ): Promise<RevenueSummaryResponseDto> {
    const dateFilter: Prisma.DateTimeFilter = {};
    if (query.dateFrom) dateFilter.gte = new Date(query.dateFrom);
    if (query.dateTo) dateFilter.lte = new Date(query.dateTo);
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const invoiceWhere: Prisma.InvoiceWhereInput = {
      clinicId,
      deletedAt: null,
      status: { not: 'DRAFT' },
      ...(hasDateFilter ? { issuedAt: dateFilter } : {}),
    };
    const paymentWhere: Prisma.PaymentWhereInput = {
      clinicId,
      status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'] },
      ...(hasDateFilter ? { paidAt: dateFilter } : {}),
    };

    const [invoiceAgg, paymentAgg, byMethod, refundAgg] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: invoiceWhere,
        _sum: { totalAmount: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: paymentWhere,
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payment.groupBy({
        by: ['method'],
        where: paymentWhere,
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.refund.aggregate({
        where: {
          clinicId,
          status: 'COMPLETED',
          ...(hasDateFilter ? { processedAt: dateFilter } : {}),
        },
        _sum: { amount: true },
      }),
    ]);

    const totalInvoiced = round2(Number(invoiceAgg._sum.totalAmount ?? 0));
    const totalCollected = round2(Number(paymentAgg._sum.amount ?? 0));
    const totalRefunded = round2(Number(refundAgg._sum.amount ?? 0));

    const revenueByMethod: RevenueByMethod[] = byMethod.map((row) => ({
      method: row.method,
      totalCollected: round2(Number(row._sum.amount ?? 0)).toFixed(2),
      paymentCount: row._count,
    }));

    return {
      totalInvoiced: totalInvoiced.toFixed(2),
      totalCollected: totalCollected.toFixed(2),
      totalRefunded: totalRefunded.toFixed(2),
      totalOutstanding: round2(totalInvoiced - totalCollected + totalRefunded).toFixed(2),
      invoiceCount: invoiceAgg._count,
      paymentCount: paymentAgg._count,
      byMethod: revenueByMethod,
    };
  }

  private assertDraft(row: InvoiceWithItems): void {
    if (row.status !== 'DRAFT') {
      throw new ConflictException('Cannot modify items on an issued invoice');
    }
  }

  private buildItemData(dto: CreateInvoiceItemDto, sortOrder: number) {
    const quantity = dto.quantity ?? 1;
    const discountAmount = dto.discountAmount ?? 0;
    const taxRatePercent = dto.taxRatePercent ?? 0;
    return {
      description: dto.description,
      itemType: dto.itemType ?? 'OTHER',
      quantity,
      unitPrice: dto.unitPrice,
      discountAmount,
      taxRatePercent,
      lineTotal: computeLineTotal(quantity, dto.unitPrice, discountAmount, taxRatePercent),
      sortOrder,
    };
  }

  private async findActiveRowOrThrow(
    clinicId: string,
    id: string,
    scope?: BillingOwnershipScope,
  ): Promise<InvoiceWithItems> {
    const row = await this.prisma.invoice.findFirst({
      where: { id, clinicId, deletedAt: null },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Invoice not found');
    if (scope?.patientId) {
      if (row.patientId !== scope.patientId) throw new ForbiddenException('Not your invoice');
      if (row.status === 'DRAFT') throw new NotFoundException('Invoice not found');
    }
    return row;
  }

  private async toResponseDto(
    clinicId: string,
    invoice: InvoiceWithItems,
  ): Promise<InvoiceResponseDto> {
    const [doctorName, patientName] = await Promise.all([
      this.doctorsService
        .findById(clinicId, invoice.doctorId)
        .then((d) => `${d.firstName} ${d.lastName}`)
        .catch(() => 'Unknown doctor'),
      this.patientsService
        .findById(clinicId, invoice.patientId)
        .then((p) => `${p.firstName} ${p.lastName}`)
        .catch(() => 'Unknown patient'),
    ]);

    const balanceDue = round2(Number(invoice.totalAmount) - Number(invoice.amountPaid));

    return {
      id: invoice.id,
      clinicId: invoice.clinicId,
      consultationId: invoice.consultationId,
      doctorId: invoice.doctorId,
      doctorName,
      patientId: invoice.patientId,
      patientName,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status as InvoiceResponseDto['status'],
      subtotal: invoice.subtotal.toString(),
      discountAmount: invoice.discountAmount.toString(),
      taxAmount: invoice.taxAmount.toString(),
      totalAmount: invoice.totalAmount.toString(),
      amountPaid: invoice.amountPaid.toString(),
      balanceDue: balanceDue.toFixed(2),
      notes: invoice.notes,
      items: invoice.items.map((item) => ({
        id: item.id,
        description: item.description,
        itemType: item.itemType as InvoiceResponseDto['items'][number]['itemType'],
        quantity: item.quantity,
        unitPrice: item.unitPrice.toString(),
        discountAmount: item.discountAmount.toString(),
        taxRatePercent: item.taxRatePercent.toString(),
        lineTotal: item.lineTotal.toString(),
        sortOrder: item.sortOrder,
      })),
      createdByUserId: invoice.createdByUserId,
      issuedAt: invoice.issuedAt,
      dueDate: invoice.dueDate,
      voidedAt: invoice.voidedAt,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
    };
  }
}
