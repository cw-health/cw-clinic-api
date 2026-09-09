import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PharmacyDispense, PharmacyDispenseItem, Prisma } from '@prisma/client';
import { AuditActions } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import { BranchesService } from '../branches/branches.service';
import type { AuditRequestContext } from '../common/decorators/audit-context.decorator';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import { assertScopedWrite } from '../common/scoped-write.util';
import { MedicinesService } from '../medicines/medicines.service';
import { PatientsService } from '../patients/patients.service';
import { PrescriptionsService } from '../prescriptions/prescriptions.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateDispenseDto } from './dto/create-dispense.dto';
import type { DispenseResponseDto } from './dto/dispense-response.dto';
import type { QueryDispensesDto } from './dto/query-dispenses.dto';

type DispenseWithItems = PharmacyDispense & { items: PharmacyDispenseItem[] };

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * The Dispensing layer — the last stage before (future, out of scope)
 * billing. `create` allocates each requested quantity across the
 * medicine's non-expired batches FEFO (first-expiry-first-out), writes one
 * DISPENSE `StockMovement` per batch consumed (traceability — see
 * `PharmacyDispenseItem`'s doc comment), and, when `prescriptionId` is
 * given, requires the prescription to be FINALIZED first (task brief:
 * "prepare for prescription dispensing").
 */
@Injectable()
export class DispensingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientsService: PatientsService,
    private readonly prescriptionsService: PrescriptionsService,
    private readonly medicinesService: MedicinesService,
    private readonly branchesService: BranchesService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    clinicId: string,
    actorUserId: string,
    dto: CreateDispenseDto,
    reqCtx?: AuditRequestContext,
  ): Promise<DispenseResponseDto> {
    // Tenant+branch isolation: a branchId must belong to this clinic.
    if (dto.branchId) await this.branchesService.findById(clinicId, dto.branchId);
    await this.patientsService.findById(clinicId, dto.patientId);

    let validPrescriptionItemIds: Set<string> | undefined;
    if (dto.prescriptionId) {
      const prescription = await this.prescriptionsService.findById(clinicId, dto.prescriptionId);
      if (prescription.patientId !== dto.patientId) {
        throw new BadRequestException('This prescription does not belong to the given patient');
      }
      if (prescription.status !== 'FINALIZED') {
        throw new ConflictException('Only a finalized prescription can be dispensed against');
      }
      validPrescriptionItemIds = new Set(prescription.items.map((i) => i.id));
    }
    for (const item of dto.items) {
      if (item.prescriptionItemId && !validPrescriptionItemIds?.has(item.prescriptionItemId)) {
        throw new BadRequestException(
          'prescriptionItemId does not belong to the given prescription',
        );
      }
    }

    // Resolve + snapshot each medicine's name up front (also verifies
    // every medicineId belongs to this clinic before any write happens).
    const medicineNames = new Map<string, string>();
    for (const item of dto.items) {
      if (!medicineNames.has(item.medicineId)) {
        const medicine = await this.medicinesService.findByIdForReference(
          clinicId,
          item.medicineId,
        );
        medicineNames.set(item.medicineId, medicine.name);
      }
    }

    const dispenseId = await this.prisma.$transaction(async (tx) => {
      const dispense = await tx.pharmacyDispense.create({
        data: {
          clinicId,
          branchId: dto.branchId,
          patientId: dto.patientId,
          prescriptionId: dto.prescriptionId,
          dispensedByUserId: actorUserId,
          notes: dto.notes,
        },
      });

      for (const item of dto.items) {
        const batches = await tx.medicineBatch.findMany({
          where: {
            clinicId,
            medicineId: item.medicineId,
            ...(dto.branchId ? { branchId: dto.branchId } : {}),
            quantityOnHand: { gt: 0 },
            expiryDate: { gte: new Date() },
          },
          orderBy: { expiryDate: 'asc' },
        });

        let remaining = item.quantity;
        let costTotal = 0;
        const consumptions: { batchId: string; quantity: number; quantityBefore: number }[] = [];
        for (const batch of batches) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, batch.quantityOnHand);
          consumptions.push({
            batchId: batch.id,
            quantity: take,
            quantityBefore: batch.quantityOnHand,
          });
          costTotal += take * Number(batch.sellingPrice);
          remaining -= take;
        }
        if (remaining > 0) {
          throw new BadRequestException(
            `Insufficient stock for ${medicineNames.get(item.medicineId)}: short by ${remaining} unit(s)`,
          );
        }

        const dispenseItem = await tx.pharmacyDispenseItem.create({
          data: {
            dispenseId: dispense.id,
            medicineId: item.medicineId,
            medicineName: medicineNames.get(item.medicineId) ?? '',
            prescriptionItemId: item.prescriptionItemId,
            quantity: item.quantity,
            unitPrice: round2(costTotal / item.quantity),
          },
        });

        for (const c of consumptions) {
          const updateResult = await tx.medicineBatch.updateMany({
            where: { id: c.batchId, clinicId },
            data: { quantityOnHand: { decrement: c.quantity } },
          });
          assertScopedWrite(updateResult, 'Batch not found');

          await tx.stockMovement.create({
            data: {
              clinicId,
              branchId: dto.branchId,
              medicineId: item.medicineId,
              batchId: c.batchId,
              type: 'DISPENSE',
              quantity: -c.quantity,
              quantityBefore: c.quantityBefore,
              quantityAfter: c.quantityBefore - c.quantity,
              referenceType: 'DISPENSE',
              referenceId: dispenseItem.id,
              performedByUserId: actorUserId,
            },
          });
        }
      }

      return dispense.id;
    });

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'PharmacyDispense',
      entityId: dispenseId,
      action: AuditActions.PHARMACY_DISPENSED,
      changedFields: `patientId=${dto.patientId},prescriptionId=${dto.prescriptionId ?? ''},items=${dto.items.length}`,
      ...reqCtx,
    });

    return this.findById(clinicId, dispenseId);
  }

  async findAll(
    clinicId: string,
    query: QueryDispensesDto,
  ): Promise<PaginatedResult<DispenseResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.PharmacyDispenseWhereInput = {
      clinicId,
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.prescriptionId ? { prescriptionId: query.prescriptionId } : {}),
    };

    const [total, dispenses] = await this.prisma.$transaction([
      this.prisma.pharmacyDispense.count({ where }),
      this.prisma.pharmacyDispense.findMany({
        where,
        include: { items: true },
        orderBy: { dispensedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { data: dispenses.map((d) => this.toResponseDto(d)), meta: { total, page, pageSize } };
  }

  async findById(clinicId: string, id: string): Promise<DispenseResponseDto> {
    const row = await this.prisma.pharmacyDispense.findFirst({
      where: { id, clinicId },
      include: { items: true },
    });
    if (!row) throw new NotFoundException('Dispense record not found');
    return this.toResponseDto(row);
  }

  private toResponseDto(dispense: DispenseWithItems): DispenseResponseDto {
    return {
      id: dispense.id,
      clinicId: dispense.clinicId,
      branchId: dispense.branchId,
      patientId: dispense.patientId,
      prescriptionId: dispense.prescriptionId,
      status: dispense.status,
      dispensedByUserId: dispense.dispensedByUserId,
      dispensedAt: dispense.dispensedAt,
      notes: dispense.notes,
      items: dispense.items.map((i) => ({
        id: i.id,
        medicineId: i.medicineId,
        medicineName: i.medicineName,
        prescriptionItemId: i.prescriptionItemId,
        quantity: i.quantity,
        unitPrice: i.unitPrice.toString(),
      })),
      createdAt: dispense.createdAt,
      updatedAt: dispense.updatedAt,
    };
  }
}
