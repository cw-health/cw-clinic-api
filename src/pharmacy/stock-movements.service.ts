import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, StockMovement } from '@prisma/client';
import { AuditActions } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import type { AuditRequestContext } from '../common/decorators/audit-context.decorator';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import { assertScopedWrite } from '../common/scoped-write.util';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from './inventory.service';
import type { CreateStockMovementDto } from './dto/create-stock-movement.dto';
import type { QueryStockMovementsDto } from './dto/query-stock-movements.dto';
import type { StockMovementResponseDto } from './dto/stock-movement-response.dto';

type MovementWithMedicineAndBatch = StockMovement & {
  medicine: { name: string };
  batch: { batchNumber: string };
};

/**
 * The Stock layer: the append-only ledger, plus the one endpoint that
 * writes to it by hand (`create` — RETURN/ADJUSTMENT/EXPIRED/DAMAGED).
 * PURCHASE/DISPENSE movements are written by PurchasesService/
 * DispensingService as part of their own flow, never through here.
 */
@Injectable()
export class StockMovementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    clinicId: string,
    actorUserId: string,
    dto: CreateStockMovementDto,
    reqCtx?: AuditRequestContext,
  ): Promise<StockMovementResponseDto> {
    if (dto.type === 'RETURN' && dto.direction !== 'IN') {
      throw new BadRequestException('RETURN must be direction IN');
    }
    if ((dto.type === 'EXPIRED' || dto.type === 'DAMAGED') && dto.direction !== 'OUT') {
      throw new BadRequestException(`${dto.type} must be direction OUT`);
    }

    const batch = await this.inventoryService.findBatchForWrite(clinicId, dto.batchId);
    const quantityBefore = batch.quantityOnHand;
    const delta = dto.direction === 'IN' ? dto.quantity : -dto.quantity;
    const quantityAfter = quantityBefore + delta;
    if (quantityAfter < 0) {
      throw new BadRequestException(
        `This movement would leave batch "${batch.batchNumber}" at a negative quantity (currently ${quantityBefore})`,
      );
    }

    const movementId = await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.medicineBatch.updateMany({
        where: { id: batch.id, clinicId },
        data: { quantityOnHand: quantityAfter },
      });
      assertScopedWrite(updateResult, 'Batch not found');

      const movement = await tx.stockMovement.create({
        data: {
          clinicId,
          branchId: batch.branchId,
          medicineId: batch.medicineId,
          batchId: batch.id,
          type: dto.type,
          quantity: delta,
          quantityBefore,
          quantityAfter,
          referenceType: 'MANUAL',
          reason: dto.reason,
          performedByUserId: actorUserId,
        },
      });
      return movement.id;
    });

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'StockMovement',
      entityId: movementId,
      action: AuditActions.PHARMACY_STOCK_ADJUSTED,
      changedFields: `type=${dto.type},direction=${dto.direction},quantity=${dto.quantity},batchId=${dto.batchId}`,
      ...reqCtx,
    });

    return this.findById(clinicId, movementId);
  }

  async findAll(
    clinicId: string,
    query: QueryStockMovementsDto,
  ): Promise<PaginatedResult<StockMovementResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.StockMovementWhereInput = {
      clinicId,
      ...(query.medicineId ? { medicineId: query.medicineId } : {}),
      ...(query.batchId ? { batchId: query.batchId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    const [total, movements] = await this.prisma.$transaction([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        include: { medicine: { select: { name: true } }, batch: { select: { batchNumber: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { data: movements.map((m) => this.toResponseDto(m)), meta: { total, page, pageSize } };
  }

  async findById(clinicId: string, id: string): Promise<StockMovementResponseDto> {
    const movement = await this.prisma.stockMovement.findFirst({
      where: { id, clinicId },
      include: { medicine: { select: { name: true } }, batch: { select: { batchNumber: true } } },
    });
    if (!movement) throw new NotFoundException('Stock movement not found');
    return this.toResponseDto(movement);
  }

  private toResponseDto(movement: MovementWithMedicineAndBatch): StockMovementResponseDto {
    return {
      id: movement.id,
      clinicId: movement.clinicId,
      branchId: movement.branchId,
      medicineId: movement.medicineId,
      medicineName: movement.medicine.name,
      batchId: movement.batchId,
      batchNumber: movement.batch.batchNumber,
      type: movement.type,
      quantity: movement.quantity,
      quantityBefore: movement.quantityBefore,
      quantityAfter: movement.quantityAfter,
      referenceType: movement.referenceType,
      referenceId: movement.referenceId,
      reason: movement.reason,
      performedByUserId: movement.performedByUserId,
      createdAt: movement.createdAt,
    };
  }
}
