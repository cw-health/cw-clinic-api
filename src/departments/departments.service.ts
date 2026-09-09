import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Department, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import type { CreateDepartmentDto } from './dto/create-department.dto';
import type { UpdateDepartmentDto } from './dto/update-department.dto';
import type { QueryDepartmentsDto } from './dto/query-departments.dto';
import type { DepartmentResponseDto } from './dto/department-response.dto';

type DepartmentWithRelations = Department & {
  branch: { id: string; name: string; code: string } | null;
  doctors: { doctorId: string }[];
};

const DEPARTMENT_INCLUDE = {
  branch: { select: { id: true, name: true, code: true } },
  doctors: { select: { doctorId: true } },
} satisfies Prisma.DepartmentInclude;

/**
 * Department Management (Phase 1C). Departments belong to a Branch, which
 * belongs to a Clinic (Clinic -> Branch -> Department) — every method takes
 * `clinicId` from the caller's resolved TenantContext (never from client
 * input, docs/SECURITY.md §4) and every query/mutation is scoped to it, the
 * same tenant-isolation discipline as BranchesService/DoctorsService.
 * Uniqueness of name/code is enforced within the branch, not the clinic,
 * since two branches of the same clinic may each run their own department
 * of the same name (e.g. both have an "OPD").
 */
@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(clinicId: string, dto: CreateDepartmentDto): Promise<DepartmentResponseDto> {
    await this.assertBranchBelongsToClinic(clinicId, dto.branchId);
    await this.assertCodeAndNameAvailable(dto.branchId, dto.code, dto.name);
    await this.assertDoctorsExist(clinicId, dto.doctorIds);

    const department = await this.prisma.$transaction(async (tx) => {
      return tx.department.create({
        data: {
          clinicId,
          branchId: dto.branchId,
          name: dto.name,
          code: dto.code,
          description: dto.description,
          doctors: dto.doctorIds
            ? { create: dto.doctorIds.map((doctorId) => ({ doctorId })) }
            : undefined,
        },
        include: DEPARTMENT_INCLUDE,
      });
    });

    return toDepartmentResponseDto(department);
  }

  async findAll(
    clinicId: string,
    query: QueryDepartmentsDto,
  ): Promise<PaginatedResult<DepartmentResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.DepartmentWhereInput = {
      clinicId,
      deletedAt: null,
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [{ name: { contains: query.search } }, { code: { contains: query.search } }],
          }
        : {}),
    };

    const sortBy = query.sortBy ?? 'name';
    const sortOrder = query.sortOrder ?? 'asc';
    const orderBy: Prisma.DepartmentOrderByWithRelationInput = { [sortBy]: sortOrder };

    const [total, departments] = await this.prisma.$transaction([
      this.prisma.department.count({ where }),
      this.prisma.department.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: DEPARTMENT_INCLUDE,
      }),
    ]);

    return {
      data: departments.map(toDepartmentResponseDto),
      meta: { total, page, pageSize },
    };
  }

  async findById(clinicId: string, id: string): Promise<DepartmentResponseDto> {
    const department = await this.findActiveDepartmentOrThrow(clinicId, id);
    return toDepartmentResponseDto(department);
  }

  async update(
    clinicId: string,
    id: string,
    dto: UpdateDepartmentDto,
  ): Promise<DepartmentResponseDto> {
    const existing = await this.findActiveDepartmentOrThrow(clinicId, id);
    if (existing.status === 'ARCHIVED') {
      throw new ConflictException('An archived department cannot be updated');
    }

    const targetBranchId = dto.branchId ?? existing.branchId;
    if (dto.branchId && dto.branchId !== existing.branchId) {
      await this.assertBranchBelongsToClinic(clinicId, dto.branchId);
    }

    if (
      (dto.code && dto.code !== existing.code) ||
      (dto.name && dto.name !== existing.name) ||
      dto.branchId
    ) {
      await this.assertCodeAndNameAvailable(
        targetBranchId,
        dto.code ?? existing.code,
        dto.name ?? existing.name,
        id,
      );
    }

    await this.assertDoctorsExist(clinicId, dto.doctorIds);

    const { doctorIds, ...rest } = dto;

    const department = await this.prisma.$transaction(async (tx) => {
      if (doctorIds) {
        await tx.doctorDepartment.deleteMany({ where: { departmentId: id } });
        if (doctorIds.length > 0) {
          await tx.doctorDepartment.createMany({
            data: doctorIds.map((doctorId) => ({ doctorId, departmentId: id })),
          });
        }
      }
      return tx.department.update({ where: { id }, data: rest, include: DEPARTMENT_INCLUDE });
    });

    return toDepartmentResponseDto(department);
  }

  async updateStatus(
    clinicId: string,
    id: string,
    status: 'ACTIVE' | 'INACTIVE',
  ): Promise<DepartmentResponseDto> {
    const existing = await this.findActiveDepartmentOrThrow(clinicId, id);
    if (existing.status === 'ARCHIVED') {
      throw new ConflictException(
        'An archived department cannot change status; it is a terminal state',
      );
    }

    const department = await this.prisma.department.update({
      where: { id },
      data: { status },
      include: DEPARTMENT_INCLUDE,
    });
    return toDepartmentResponseDto(department);
  }

  /** Archive is a one-way status transition, never a hard delete — matches Branch/Clinic's own archive semantics. */
  async archive(clinicId: string, id: string): Promise<DepartmentResponseDto> {
    const existing = await this.findActiveDepartmentOrThrow(clinicId, id);
    if (existing.status === 'ARCHIVED') {
      throw new ConflictException('Department is already archived');
    }

    const department = await this.prisma.department.update({
      where: { id },
      data: { status: 'ARCHIVED' },
      include: DEPARTMENT_INCLUDE,
    });
    return toDepartmentResponseDto(department);
  }

  private async findActiveDepartmentOrThrow(
    clinicId: string,
    id: string,
  ): Promise<DepartmentWithRelations> {
    const department = await this.prisma.department.findFirst({
      where: { id, clinicId, deletedAt: null },
      include: DEPARTMENT_INCLUDE,
    });
    if (!department) throw new NotFoundException('Department not found');
    return department;
  }

  /** A branchId is client-supplied and must never be trusted without verifying it belongs to the caller's own clinic (docs/SECURITY.md §4). */
  private async assertBranchBelongsToClinic(clinicId: string, branchId: string): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, clinicId, deletedAt: null },
    });
    if (!branch) throw new BadRequestException('branchId does not belong to this clinic');
  }

  /** Uniqueness of (branchId, code) and (branchId, name) — DB-enforced too, checked here first for a clean 409 instead of a raw constraint-violation 500. */
  private async assertCodeAndNameAvailable(
    branchId: string,
    code: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const [byCode, byName] = await this.prisma.$transaction([
      this.prisma.department.findFirst({
        where: {
          branchId,
          code,
          deletedAt: null,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      }),
      this.prisma.department.findFirst({
        where: {
          branchId,
          name,
          deletedAt: null,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      }),
    ]);
    if (byCode)
      throw new ConflictException('A department with this code already exists in this branch');
    if (byName)
      throw new ConflictException('A department with this name already exists in this branch');
  }

  /** doctorIds are client-supplied; each must be a doctor belonging to the same clinic (same pattern as DoctorsService.assertSpecializationsExist). */
  private async assertDoctorsExist(clinicId: string, ids: string[] | undefined): Promise<void> {
    if (!ids || ids.length === 0) return;
    const count = await this.prisma.doctor.count({
      where: { id: { in: ids }, clinicId, deletedAt: null },
    });
    if (count !== ids.length) {
      throw new BadRequestException('One or more doctorIds do not exist in this clinic');
    }
  }
}

function toDepartmentResponseDto(department: DepartmentWithRelations): DepartmentResponseDto {
  return {
    id: department.id,
    clinicId: department.clinicId,
    branchId: department.branchId,
    branch: department.branch,
    name: department.name,
    code: department.code,
    description: department.description,
    status: department.status,
    doctorIds: department.doctors.map((d) => d.doctorId),
    createdAt: department.createdAt,
    updatedAt: department.updatedAt,
  };
}
