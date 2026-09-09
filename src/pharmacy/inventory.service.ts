import { Injectable, NotFoundException } from '@nestjs/common';
import type { MedicineBatch, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import type { MedicineBatchResponseDto, StockSummaryResponseDto } from './dto/batch-response.dto';
import type { QueryBatchesDto, QueryStockSummaryDto } from './dto/query-batches.dto';

type BatchWithMedicine = MedicineBatch & { medicine: { name: string } };

/**
 * Read surface over the Inventory layer (`MedicineBatch`) — the per-batch
 * stock a clinic is holding. Never writes: batches are created/adjusted
 * only by PurchasesService (receipt), StockMovementsService (manual
 * return/adjustment/expired/damaged), and DispensingService (consumption),
 * each in the same transaction as the `StockMovement` row that explains
 * the change.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllBatches(
    clinicId: string,
    query: QueryBatchesDto,
  ): Promise<PaginatedResult<MedicineBatchResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const includeDepleted = query.includeDepleted ?? false;
    const includeExpired = query.includeExpired ?? true;

    const where: Prisma.MedicineBatchWhereInput = {
      clinicId,
      ...(query.medicineId ? { medicineId: query.medicineId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(includeDepleted ? {} : { quantityOnHand: { gt: 0 } }),
      ...(includeExpired ? {} : { expiryDate: { gte: new Date() } }),
    };

    const [total, batches] = await this.prisma.$transaction([
      this.prisma.medicineBatch.count({ where }),
      this.prisma.medicineBatch.findMany({
        where,
        include: { medicine: { select: { name: true } } },
        orderBy: { expiryDate: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data: batches.map((b) => this.toResponseDto(b)),
      meta: { total, page, pageSize },
    };
  }

  async findBatchById(clinicId: string, id: string): Promise<MedicineBatchResponseDto> {
    const batch = await this.findActiveRowOrThrow(clinicId, id);
    return this.toResponseDto(batch);
  }

  /** Used by StockMovementsService/DispensingService to resolve a batchId reference. */
  async findBatchForWrite(clinicId: string, id: string): Promise<MedicineBatch> {
    return this.findActiveRowOrThrow(clinicId, id);
  }

  /**
   * FEFO (first-expiry-first-out) candidate batches for a medicine —
   * non-expired, with stock on hand, ordered soonest-expiry-first.
   * DispensingService allocates a requested quantity across these.
   */
  async findDispensableBatches(
    clinicId: string,
    medicineId: string,
    branchId: string | undefined | null,
  ): Promise<MedicineBatch[]> {
    return this.prisma.medicineBatch.findMany({
      where: {
        clinicId,
        medicineId,
        ...(branchId ? { branchId } : {}),
        quantityOnHand: { gt: 0 },
        expiryDate: { gte: new Date() },
      },
      orderBy: { expiryDate: 'asc' },
    });
  }

  /** Current stock level per medicine — an aggregated read model, not a stored total (see MedicineBatch's doc comment). */
  async findStockSummary(
    clinicId: string,
    query: QueryStockSummaryDto,
  ): Promise<StockSummaryResponseDto[]> {
    const where: Prisma.MedicineBatchWhereInput = {
      clinicId,
      ...(query.branchId ? { branchId: query.branchId } : {}),
      quantityOnHand: { gt: 0 },
    };

    const batches = await this.prisma.medicineBatch.findMany({
      where,
      include: { medicine: { select: { id: true, name: true, unit: true } } },
    });

    const byMedicine = new Map<
      string,
      {
        medicineName: string;
        unit: string | null;
        total: number;
        count: number;
        nearest: Date | null;
      }
    >();
    for (const batch of batches) {
      const existing = byMedicine.get(batch.medicineId);
      if (existing) {
        existing.total += batch.quantityOnHand;
        existing.count += 1;
        if (!existing.nearest || batch.expiryDate < existing.nearest) {
          existing.nearest = batch.expiryDate;
        }
      } else {
        byMedicine.set(batch.medicineId, {
          medicineName: batch.medicine.name,
          unit: batch.medicine.unit,
          total: batch.quantityOnHand,
          count: 1,
          nearest: batch.expiryDate,
        });
      }
    }

    return [...byMedicine.entries()]
      .map(([medicineId, v]) => ({
        medicineId,
        medicineName: v.medicineName,
        unit: v.unit,
        totalQuantityOnHand: v.total,
        batchCount: v.count,
        nearestExpiryDate: v.nearest,
      }))
      .sort((a, b) => a.medicineName.localeCompare(b.medicineName));
  }

  private async findActiveRowOrThrow(clinicId: string, id: string): Promise<BatchWithMedicine> {
    const batch = await this.prisma.medicineBatch.findFirst({
      where: { id, clinicId },
      include: { medicine: { select: { name: true } } },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }

  private toResponseDto(batch: BatchWithMedicine): MedicineBatchResponseDto {
    return {
      id: batch.id,
      clinicId: batch.clinicId,
      branchId: batch.branchId,
      medicineId: batch.medicineId,
      medicineName: batch.medicine.name,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      quantityReceived: batch.quantityReceived,
      quantityOnHand: batch.quantityOnHand,
      purchasePrice: batch.purchasePrice.toString(),
      sellingPrice: batch.sellingPrice.toString(),
      isExpired: batch.expiryDate < new Date(),
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
    };
  }
}
