import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, PurchaseInvoice, PurchaseItem } from '@prisma/client';
import { AuditActions } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import { BranchesService } from '../branches/branches.service';
import type { AuditRequestContext } from '../common/decorators/audit-context.decorator';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import { MedicinesService } from '../medicines/medicines.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreatePurchaseDto } from './dto/create-purchase.dto';
import type { PurchaseResponseDto } from './dto/purchase-response.dto';
import type { QueryPurchasesDto } from './dto/query-purchases.dto';

type PurchaseWithItems = PurchaseInvoice & { items: PurchaseItem[] };

/**
 * The Purchase layer: recording stock received into inventory. Each
 * `PurchaseItem` line creates or restocks exactly one `MedicineBatch` and
 * writes one PURCHASE `StockMovement`, all in one transaction — the only
 * system-generated origin of a PURCHASE movement (see StockMovement's doc
 * comment). No supplier master, no PO/approval workflow: this only records
 * what physically arrived (task brief: "do not implement online pharmacy
 * ordering").
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly medicinesService: MedicinesService,
    private readonly branchesService: BranchesService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    clinicId: string,
    actorUserId: string,
    dto: CreatePurchaseDto,
    reqCtx?: AuditRequestContext,
  ): Promise<PurchaseResponseDto> {
    // Tenant+branch isolation: a branchId must belong to this clinic.
    if (dto.branchId) await this.branchesService.findById(clinicId, dto.branchId);

    // Resolve + snapshot each medicine's name up front (also verifies
    // every medicineId belongs to this clinic before any write happens).
    const medicines = new Map<string, string>();
    for (const item of dto.items) {
      if (!medicines.has(item.medicineId)) {
        const medicine = await this.medicinesService.findByIdForReference(
          clinicId,
          item.medicineId,
        );
        medicines.set(item.medicineId, medicine.name);
      }
    }

    const purchaseId = await this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchaseInvoice.create({
        data: {
          clinicId,
          branchId: dto.branchId,
          supplierName: dto.supplierName,
          invoiceNumber: dto.invoiceNumber,
          purchaseDate: new Date(dto.purchaseDate),
          notes: dto.notes,
          createdByUserId: actorUserId,
        },
      });

      for (const item of dto.items) {
        const expiryDate = new Date(item.expiryDate);
        const existingBatch = await tx.medicineBatch.findFirst({
          where: {
            clinicId,
            medicineId: item.medicineId,
            branchId: dto.branchId ?? null,
            batchNumber: item.batchNumber,
          },
        });

        let batchId: string;
        let quantityBefore: number;
        if (existingBatch) {
          if (existingBatch.expiryDate.getTime() !== expiryDate.getTime()) {
            throw new ConflictException(
              `Batch "${item.batchNumber}" already exists for this medicine with a different expiry date`,
            );
          }
          quantityBefore = existingBatch.quantityOnHand;
          const updated = await tx.medicineBatch.update({
            where: { id: existingBatch.id },
            data: {
              quantityReceived: { increment: item.quantity },
              quantityOnHand: { increment: item.quantity },
              purchasePrice: item.purchasePrice,
              sellingPrice: item.sellingPrice,
            },
          });
          batchId = updated.id;
        } else {
          quantityBefore = 0;
          const created = await tx.medicineBatch.create({
            data: {
              clinicId,
              branchId: dto.branchId,
              medicineId: item.medicineId,
              batchNumber: item.batchNumber,
              expiryDate,
              quantityReceived: item.quantity,
              quantityOnHand: item.quantity,
              purchasePrice: item.purchasePrice,
              sellingPrice: item.sellingPrice,
            },
          });
          batchId = created.id;
        }

        const purchaseItem = await tx.purchaseItem.create({
          data: {
            purchaseId: purchase.id,
            medicineId: item.medicineId,
            medicineName: medicines.get(item.medicineId) ?? '',
            batchId,
            batchNumber: item.batchNumber,
            expiryDate,
            quantity: item.quantity,
            purchasePrice: item.purchasePrice,
            sellingPrice: item.sellingPrice,
          },
        });

        await tx.stockMovement.create({
          data: {
            clinicId,
            branchId: dto.branchId,
            medicineId: item.medicineId,
            batchId,
            type: 'PURCHASE',
            quantity: item.quantity,
            quantityBefore,
            quantityAfter: quantityBefore + item.quantity,
            referenceType: 'PURCHASE',
            referenceId: purchaseItem.id,
            performedByUserId: actorUserId,
          },
        });
      }

      return purchase.id;
    });

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'PurchaseInvoice',
      entityId: purchaseId,
      action: AuditActions.PHARMACY_PURCHASE_RECORDED,
      changedFields: `supplierName=${dto.supplierName},items=${dto.items.length}`,
      ...reqCtx,
    });

    return this.findById(clinicId, purchaseId);
  }

  async findAll(
    clinicId: string,
    query: QueryPurchasesDto,
  ): Promise<PaginatedResult<PurchaseResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.PurchaseInvoiceWhereInput = {
      clinicId,
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.medicineId ? { items: { some: { medicineId: query.medicineId } } } : {}),
    };

    const [total, purchases] = await this.prisma.$transaction([
      this.prisma.purchaseInvoice.count({ where }),
      this.prisma.purchaseInvoice.findMany({
        where,
        include: { items: true },
        orderBy: { purchaseDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { data: purchases.map((p) => this.toResponseDto(p)), meta: { total, page, pageSize } };
  }

  async findById(clinicId: string, id: string): Promise<PurchaseResponseDto> {
    const row = await this.prisma.purchaseInvoice.findFirst({
      where: { id, clinicId },
      include: { items: true },
    });
    if (!row) throw new NotFoundException('Purchase not found');
    return this.toResponseDto(row);
  }

  private toResponseDto(purchase: PurchaseWithItems): PurchaseResponseDto {
    const totalAmount = purchase.items.reduce(
      (sum, i) => sum + i.quantity * Number(i.purchasePrice),
      0,
    );
    return {
      id: purchase.id,
      clinicId: purchase.clinicId,
      branchId: purchase.branchId,
      supplierName: purchase.supplierName,
      invoiceNumber: purchase.invoiceNumber,
      purchaseDate: purchase.purchaseDate,
      notes: purchase.notes,
      createdByUserId: purchase.createdByUserId,
      totalAmount: totalAmount.toFixed(2),
      items: purchase.items.map((i) => ({
        id: i.id,
        medicineId: i.medicineId,
        medicineName: i.medicineName,
        batchId: i.batchId,
        batchNumber: i.batchNumber,
        expiryDate: i.expiryDate,
        quantity: i.quantity,
        purchasePrice: i.purchasePrice.toString(),
        sellingPrice: i.sellingPrice.toString(),
      })),
      createdAt: purchase.createdAt,
      updatedAt: purchase.updatedAt,
    };
  }
}
