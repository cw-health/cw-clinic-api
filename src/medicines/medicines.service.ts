import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Medicine, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import type { CreateMedicineDto } from './dto/create-medicine.dto';
import type { MedicineResponseDto } from './dto/medicine-response.dto';
import type { QueryMedicinesDto } from './dto/query-medicines.dto';
import type { UpdateMedicineDto } from './dto/update-medicine.dto';

/**
 * Formulary catalog. Deliberately no bulk import/seed of a "complete
 * medical database" (task brief) — clinics build their own catalog one
 * entry at a time via `create`. A catalog entry is never hard-deleted once
 * it may have been referenced by a PrescriptionItem: `isActive: false`
 * (retire) is the only removal path, so historical prescriptions keep a
 * valid `medicineId` FK.
 */
@Injectable()
export class MedicinesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(clinicId: string, dto: CreateMedicineDto): Promise<MedicineResponseDto> {
    if (dto.sku) await this.assertSkuAvailable(clinicId, dto.sku);
    try {
      const medicine = await this.prisma.medicine.create({
        data: { ...dto, clinicId },
      });
      return this.toResponseDto(medicine);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('A medicine with this name and strength already exists');
      }
      throw error;
    }
  }

  async findAll(
    clinicId: string,
    query: QueryMedicinesDto,
  ): Promise<PaginatedResult<MedicineResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.MedicineWhereInput = {
      clinicId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search } },
              { genericName: { contains: query.search } },
              { sku: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [total, medicines] = await this.prisma.$transaction([
      this.prisma.medicine.count({ where }),
      this.prisma.medicine.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { data: medicines.map((m) => this.toResponseDto(m)), meta: { total, page, pageSize } };
  }

  async findById(clinicId: string, id: string): Promise<MedicineResponseDto> {
    const medicine = await this.findActiveRowOrThrow(clinicId, id);
    return this.toResponseDto(medicine);
  }

  /** Used by PrescriptionsService when adding an item — throws if the medicine is deactivated. */
  async findPrescribableOrThrow(clinicId: string, id: string): Promise<Medicine> {
    const medicine = await this.findActiveRowOrThrow(clinicId, id);
    if (!medicine.isActive) {
      throw new ConflictException('This medicine is inactive and cannot be prescribed');
    }
    return medicine;
  }

  /**
   * Used by the pharmacy module (inventory/purchases/dispensing) to
   * resolve a `medicineId` reference — deliberately returns the raw row
   * (inactive included) rather than throwing on `isActive: false`: an
   * inactive medicine can still have existing stock that needs to be
   * viewed/adjusted/dispensed down to zero, only new prescribing is
   * blocked (see `findPrescribableOrThrow`).
   */
  async findByIdForReference(clinicId: string, id: string): Promise<Medicine> {
    return this.findActiveRowOrThrow(clinicId, id);
  }

  async update(clinicId: string, id: string, dto: UpdateMedicineDto): Promise<MedicineResponseDto> {
    const existing = await this.findActiveRowOrThrow(clinicId, id);
    if (dto.sku && dto.sku !== existing.sku) await this.assertSkuAvailable(clinicId, dto.sku, id);
    try {
      const medicine = await this.prisma.medicine.update({ where: { id }, data: dto });
      return this.toResponseDto(medicine);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('A medicine with this name and strength already exists');
      }
      throw error;
    }
  }

  private async findActiveRowOrThrow(clinicId: string, id: string): Promise<Medicine> {
    const medicine = await this.prisma.medicine.findFirst({ where: { id, clinicId } });
    if (!medicine) throw new NotFoundException('Medicine not found');
    return medicine;
  }

  // No DB-level unique constraint on sku (see the field's doc comment on
  // model Medicine) — checked here instead. excludeId lets `update` ignore
  // the row being updated when its own sku hasn't changed.
  private async assertSkuAvailable(
    clinicId: string,
    sku: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.prisma.medicine.findFirst({
      where: { clinicId, sku, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new ConflictException('A medicine with this SKU already exists');
  }

  private toResponseDto(medicine: Medicine): MedicineResponseDto {
    return {
      id: medicine.id,
      clinicId: medicine.clinicId,
      name: medicine.name,
      genericName: medicine.genericName,
      strength: medicine.strength,
      form: medicine.form,
      manufacturer: medicine.manufacturer,
      sku: medicine.sku,
      unit: medicine.unit,
      notes: medicine.notes,
      isActive: medicine.isActive,
      createdAt: medicine.createdAt,
      updatedAt: medicine.updatedAt,
    };
  }
}
