import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Branch, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import type { CreateBranchDto } from './dto/create-branch.dto';
import type { UpdateBranchDto } from './dto/update-branch.dto';
import type { QueryBranchesDto } from './dto/query-branches.dto';
import type { BranchResponseDto } from './dto/branch-response.dto';

/**
 * Branch Management (Phase 1B, docs/DECISIONS.md ADR-009). Every method
 * takes `clinicId` from the caller's resolved TenantContext (never from
 * client input, docs/SECURITY.md §4) and every query/mutation is scoped to
 * it — a Clinic A caller can never read or affect Clinic B's branches, the
 * same tenant-isolation discipline as DoctorsService/PatientsService.
 */
@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(clinicId: string, dto: CreateBranchDto): Promise<BranchResponseDto> {
    await this.assertCodeAndNameAvailable(clinicId, dto.code, dto.name);

    let timezone = dto.timezone;
    if (!timezone) {
      const clinic = await this.prisma.clinic.findUnique({
        where: { id: clinicId },
        select: { timezone: true },
      });
      timezone = clinic?.timezone ?? 'UTC';
    }

    const branch = await this.prisma.branch.create({
      data: {
        clinicId,
        name: dto.name,
        code: dto.code,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        postalCode: dto.postalCode,
        country: dto.country,
        timezone,
      },
    });

    return toBranchResponseDto(branch);
  }

  async findAll(
    clinicId: string,
    query: QueryBranchesDto,
  ): Promise<PaginatedResult<BranchResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.BranchWhereInput = {
      clinicId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [{ name: { contains: query.search } }, { code: { contains: query.search } }],
          }
        : {}),
    };

    const sortBy = query.sortBy ?? 'name';
    const sortOrder = query.sortOrder ?? 'asc';
    const orderBy: Prisma.BranchOrderByWithRelationInput = { [sortBy]: sortOrder };

    const [total, branches] = await this.prisma.$transaction([
      this.prisma.branch.count({ where }),
      this.prisma.branch.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data: branches.map(toBranchResponseDto),
      meta: { total, page, pageSize },
    };
  }

  async findById(clinicId: string, id: string): Promise<BranchResponseDto> {
    const branch = await this.findActiveBranchOrThrow(clinicId, id);
    return toBranchResponseDto(branch);
  }

  async update(clinicId: string, id: string, dto: UpdateBranchDto): Promise<BranchResponseDto> {
    const existing = await this.findActiveBranchOrThrow(clinicId, id);
    if (existing.status === 'ARCHIVED') {
      throw new ConflictException('An archived branch cannot be updated');
    }

    if ((dto.code && dto.code !== existing.code) || (dto.name && dto.name !== existing.name)) {
      await this.assertCodeAndNameAvailable(
        clinicId,
        dto.code ?? existing.code,
        dto.name ?? existing.name,
        id,
      );
    }

    const branch = await this.prisma.branch.update({ where: { id }, data: dto });
    return toBranchResponseDto(branch);
  }

  async updateStatus(
    clinicId: string,
    id: string,
    status: 'ACTIVE' | 'INACTIVE',
  ): Promise<BranchResponseDto> {
    const existing = await this.findActiveBranchOrThrow(clinicId, id);
    if (existing.status === 'ARCHIVED') {
      throw new ConflictException(
        'An archived branch cannot change status; it is a terminal state',
      );
    }

    const branch = await this.prisma.branch.update({ where: { id }, data: { status } });
    return toBranchResponseDto(branch);
  }

  /** Archive is a one-way status transition (docs/DECISIONS.md ADR-009), never a hard delete — matches Clinic's own archive semantics. */
  async archive(clinicId: string, id: string): Promise<BranchResponseDto> {
    const existing = await this.findActiveBranchOrThrow(clinicId, id);
    if (existing.status === 'ARCHIVED') {
      throw new ConflictException('Branch is already archived');
    }

    const branch = await this.prisma.branch.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
    return toBranchResponseDto(branch);
  }

  private async findActiveBranchOrThrow(clinicId: string, id: string): Promise<Branch> {
    const branch = await this.prisma.branch.findFirst({ where: { id, clinicId, deletedAt: null } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  /** Uniqueness of (clinicId, code) and (clinicId, name) — DB-enforced too, checked here first for a clean 409 instead of a raw constraint-violation 500. */
  private async assertCodeAndNameAvailable(
    clinicId: string,
    code: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const [byCode, byName] = await this.prisma.$transaction([
      this.prisma.branch.findFirst({
        where: {
          clinicId,
          code,
          deletedAt: null,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      }),
      this.prisma.branch.findFirst({
        where: {
          clinicId,
          name,
          deletedAt: null,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      }),
    ]);
    if (byCode) throw new ConflictException('A branch with this code already exists');
    if (byName) throw new ConflictException('A branch with this name already exists');
  }
}

function toBranchResponseDto(branch: Branch): BranchResponseDto {
  return {
    id: branch.id,
    clinicId: branch.clinicId,
    name: branch.name,
    code: branch.code,
    phone: branch.phone,
    email: branch.email,
    address: branch.address,
    city: branch.city,
    state: branch.state,
    postalCode: branch.postalCode,
    country: branch.country,
    timezone: branch.timezone,
    status: branch.status,
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
  };
}
