import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TenantContext } from '../auth/guards/tenant.guard';
import { AuditService } from '../audit/audit.service';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateFeatureFlagDto } from './dto/create-feature-flag.dto';
import type {
  FeatureFlagDetailResponseDto,
  FeatureFlagResponseDto,
} from './dto/feature-flag-response.dto';
import type { QueryFeatureFlagsDto } from './dto/query-feature-flags.dto';
import type { UpdateFeatureFlagDto } from './dto/update-feature-flag.dto';
import type { UpsertFeatureFlagOverrideDto } from './dto/upsert-feature-flag-override.dto';
import {
  toFeatureFlagDetailResponseDto,
  toFeatureFlagResponseDto,
} from './feature-flag-mapping.util';

/**
 * Centralized feature-flag mechanism (SA-08,
 * docs/SUPER_ADMIN_ARCHITECTURE.md §6.7). Two responsibilities live here
 * deliberately in one service rather than split across modules — the same
 * "one centralized service, not scattered checks" principle as
 * PlanLimitsService (§6.5):
 *
 *  1. **Evaluation** (`isEnabledGlobally` / `isEnabledForClinic` / `isEnabled`)
 *     — the read path any application module calls to safely check a flag.
 *     `clinicId` is only ever taken from a caller-resolved `TenantContext`
 *     (never accepted as free-form client input), so a clinic can never
 *     resolve another clinic's override (docs/SECURITY.md §4).
 *  2. **Super Admin administration** (list/create/update/enable/disable,
 *     clinic override set/remove) — every mutation writes an `AuditLog` row
 *     (reuses `AuditService`), since flags are explicitly required to be
 *     auditable.
 *
 * MVP scope only: global default + optional per-clinic override. No
 * plan-capability layer (Phase 2 per the architecture doc) and no
 * gradual-rollout/A-B targeting.
 */
@Injectable()
export class FeatureFlagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // ---------------------------------------------------------------------
  // Evaluation — safe for any application module to call.
  // ---------------------------------------------------------------------

  /** Is this flag enabled at the platform-wide default? Unknown keys fail closed (disabled). */
  async isEnabledGlobally(key: string): Promise<boolean> {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    return flag?.enabled ?? false;
  }

  /**
   * Is this flag enabled for a specific clinic? A CLINIC-scope flag's own
   * `FeatureFlagOverride` for that clinic (if any) wins over the global
   * default; a GLOBAL-scope flag always evaluates to its global default
   * regardless of any override row left over from a prior CLINIC-scope
   * period. Unknown keys fail closed (disabled).
   */
  async isEnabledForClinic(key: string, clinicId: string): Promise<boolean> {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    if (!flag) return false;

    if (flag.scope === 'CLINIC') {
      const override = await this.prisma.featureFlagOverride.findUnique({
        where: { flagId_clinicId: { flagId: flag.id, clinicId } },
      });
      if (override) return override.enabled;
    }

    return flag.enabled;
  }

  /**
   * Convenience wrapper for call sites that already hold a resolved
   * `TenantContext` (i.e. any request behind `TenantGuard`): evaluates
   * per-clinic when the session has a clinic, falls back to the global
   * default for a clinic-less SuperAdmin session. Tenant boundaries are
   * respected by construction — `tenant` only ever carries the caller's
   * own resolved clinic, never a client-supplied one.
   */
  async isEnabled(key: string, tenant: TenantContext): Promise<boolean> {
    if (tenant.clinicId) return this.isEnabledForClinic(key, tenant.clinicId);
    return this.isEnabledGlobally(key);
  }

  // ---------------------------------------------------------------------
  // Super Admin administration.
  // ---------------------------------------------------------------------

  private async getFlagRowOrThrow(id: string) {
    const flag = await this.prisma.featureFlag.findUnique({ where: { id } });
    if (!flag) throw new NotFoundException('Feature flag not found');
    return flag;
  }

  async listFlags(query: QueryFeatureFlagsDto): Promise<PaginatedResult<FeatureFlagResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.FeatureFlagWhereInput = {
      ...(query.scope ? { scope: query.scope } : {}),
      ...(query.enabled !== undefined ? { enabled: query.enabled } : {}),
      ...(query.search
        ? {
            OR: [
              { key: { contains: query.search } },
              { name: { contains: query.search } },
              { description: { contains: query.search } },
            ],
          }
        : {}),
    };

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';
    const orderBy: Prisma.FeatureFlagOrderByWithRelationInput =
      sortBy === 'key'
        ? { key: sortOrder }
        : sortBy === 'name'
          ? { name: sortOrder }
          : { createdAt: sortOrder };

    const [total, flags] = await this.prisma.$transaction([
      this.prisma.featureFlag.count({ where }),
      this.prisma.featureFlag.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { data: flags.map(toFeatureFlagResponseDto), meta: { total, page, pageSize } };
  }

  async getFlagById(id: string): Promise<FeatureFlagDetailResponseDto> {
    const flag = await this.getFlagRowOrThrow(id);
    const overrides = await this.prisma.featureFlagOverride.findMany({
      where: { flagId: id },
      include: { clinic: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return toFeatureFlagDetailResponseDto(flag, overrides);
  }

  async createFlag(
    dto: CreateFeatureFlagDto,
    actorUserId: string,
  ): Promise<FeatureFlagResponseDto> {
    const existing = await this.prisma.featureFlag.findUnique({ where: { key: dto.key } });
    if (existing) throw new ConflictException('A feature flag with this key already exists');

    const flag = await this.prisma.featureFlag.create({
      data: {
        key: dto.key,
        name: dto.name,
        description: dto.description,
        enabled: dto.enabled ?? false,
        scope: dto.scope ?? 'GLOBAL',
      },
    });

    await this.auditService.record({
      clinicId: null,
      actorUserId,
      actorType: 'PLATFORM_USER',
      entity: 'FeatureFlag',
      entityId: flag.id,
      action: 'CREATE',
      changedFields: `key:${flag.key}`,
    });

    return toFeatureFlagResponseDto(flag);
  }

  async updateFlag(
    id: string,
    dto: UpdateFeatureFlagDto,
    actorUserId: string,
  ): Promise<FeatureFlagResponseDto> {
    await this.getFlagRowOrThrow(id);

    const flag = await this.prisma.featureFlag.update({
      where: { id },
      data: { name: dto.name, description: dto.description, scope: dto.scope },
    });

    await this.auditService.record({
      clinicId: null,
      actorUserId,
      actorType: 'PLATFORM_USER',
      entity: 'FeatureFlag',
      entityId: id,
      action: 'UPDATE',
      changedFields: Object.keys(dto).join(','),
    });

    return toFeatureFlagResponseDto(flag);
  }

  private async setEnabled(
    id: string,
    enabled: boolean,
    action: string,
    actorUserId: string,
  ): Promise<FeatureFlagResponseDto> {
    await this.getFlagRowOrThrow(id);
    const flag = await this.prisma.featureFlag.update({ where: { id }, data: { enabled } });

    await this.auditService.record({
      clinicId: null,
      actorUserId,
      actorType: 'PLATFORM_USER',
      entity: 'FeatureFlag',
      entityId: id,
      action,
    });

    return toFeatureFlagResponseDto(flag);
  }

  async enableFlag(id: string, actorUserId: string): Promise<FeatureFlagResponseDto> {
    return this.setEnabled(id, true, 'ENABLE', actorUserId);
  }

  async disableFlag(id: string, actorUserId: string): Promise<FeatureFlagResponseDto> {
    return this.setEnabled(id, false, 'DISABLE', actorUserId);
  }

  /**
   * Creates or replaces a clinic's override for a flag. Only meaningful
   * for a CLINIC-scope flag — rejected outright for a GLOBAL-scope one
   * rather than silently accepting a row that evaluation would ignore.
   */
  async setClinicOverride(
    flagId: string,
    clinicId: string,
    dto: UpsertFeatureFlagOverrideDto,
    actorUserId: string,
  ): Promise<FeatureFlagResponseDto> {
    const flag = await this.getFlagRowOrThrow(flagId);
    if (flag.scope !== 'CLINIC') {
      throw new BadRequestException(
        'This flag is GLOBAL-scope — set it to CLINIC scope before configuring a clinic override',
      );
    }

    await this.prisma.featureFlagOverride.upsert({
      where: { flagId_clinicId: { flagId, clinicId } },
      create: { flagId, clinicId, enabled: dto.enabled },
      update: { enabled: dto.enabled },
    });

    await this.auditService.record({
      clinicId,
      actorUserId,
      actorType: 'PLATFORM_USER',
      entity: 'FeatureFlagOverride',
      entityId: flagId,
      action: 'SET_OVERRIDE',
      changedFields: `enabled:${dto.enabled}`,
    });

    return toFeatureFlagResponseDto(flag);
  }

  async removeClinicOverride(
    flagId: string,
    clinicId: string,
    actorUserId: string,
  ): Promise<FeatureFlagResponseDto> {
    const flag = await this.getFlagRowOrThrow(flagId);

    const existing = await this.prisma.featureFlagOverride.findUnique({
      where: { flagId_clinicId: { flagId, clinicId } },
    });
    if (!existing) throw new NotFoundException('No override exists for this clinic');

    await this.prisma.featureFlagOverride.delete({ where: { id: existing.id } });

    await this.auditService.record({
      clinicId,
      actorUserId,
      actorType: 'PLATFORM_USER',
      entity: 'FeatureFlagOverride',
      entityId: flagId,
      action: 'REMOVE_OVERRIDE',
    });

    return toFeatureFlagResponseDto(flag);
  }
}
