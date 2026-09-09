import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import type { CreatePlanDto } from './dto/create-plan.dto';
import type { PlanResponseDto } from './dto/plan-response.dto';
import type { QueryPlansDto } from './dto/query-plans.dto';
import type { UpdatePlanDto } from './dto/update-plan.dto';
import {
  PLAN_WITH_FEATURES_INCLUDE,
  toPlanResponseDto,
  type PlanWithFeatures,
} from './plan-mapping.util';

/** Plan lifecycle statuses a Super Admin can transition a plan through (SA-06). */
type PlanLifecycleStatus = 'ACTIVE' | 'INACTIVE';

/**
 * Super Admin subscription-plan catalog management (SA-06,
 * docs/SUPER_ADMIN_ARCHITECTURE.md §6.5). A `Plan` is global platform
 * catalog data — no clinicId, no tenant scoping. Every mutation records an
 * `AuditLog` entry (clinicId: null, actorType: PLATFORM_USER), same
 * pattern as ClinicsService/PlatformUsersService. Subscribing a clinic to a
 * plan is SA-07 — out of scope here.
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private async getPlanRowOrThrow(id: string): Promise<PlanWithFeatures> {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: PLAN_WITH_FEATURES_INCLUDE,
    });
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  async listPlans(query: QueryPlansDto): Promise<PaginatedResult<PlanResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.PlanWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.billingInterval ? { billingInterval: query.billingInterval } : {}),
      ...(query.search
        ? {
            OR: [{ name: { contains: query.search } }, { description: { contains: query.search } }],
          }
        : {}),
    };

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';
    const orderBy: Prisma.PlanOrderByWithRelationInput =
      sortBy === 'name'
        ? { name: sortOrder }
        : sortBy === 'price'
          ? { price: sortOrder }
          : { createdAt: sortOrder };

    const [total, plans] = await this.prisma.$transaction([
      this.prisma.plan.count({ where }),
      this.prisma.plan.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: PLAN_WITH_FEATURES_INCLUDE,
      }),
    ]);

    return { data: plans.map(toPlanResponseDto), meta: { total, page, pageSize } };
  }

  async getPlanById(id: string): Promise<PlanResponseDto> {
    return toPlanResponseDto(await this.getPlanRowOrThrow(id));
  }

  async createPlan(dto: CreatePlanDto, actorUserId: string): Promise<PlanResponseDto> {
    const existing = await this.prisma.plan.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A plan with this name already exists');

    const plan = await this.prisma.$transaction(async (tx) => {
      const created = await tx.plan.create({
        data: {
          name: dto.name,
          description: dto.description,
          price: dto.price,
          currency: dto.currency ?? 'INR',
          billingInterval: dto.billingInterval,
          maxDoctors: dto.maxDoctors,
          maxStaff: dto.maxStaff,
          maxPatients: dto.maxPatients,
          maxBranches: dto.maxBranches,
          trialDays: dto.trialDays,
        },
      });

      if (dto.features && dto.features.length > 0) {
        await tx.planFeature.createMany({
          data: dto.features.map((key) => ({ planId: created.id, key })),
        });
      }

      return tx.plan.findUniqueOrThrow({
        where: { id: created.id },
        include: PLAN_WITH_FEATURES_INCLUDE,
      });
    });

    await this.auditService.record({
      clinicId: null,
      actorUserId,
      actorType: 'PLATFORM_USER',
      entity: 'Plan',
      entityId: plan.id,
      action: 'CREATE',
    });

    return toPlanResponseDto(plan);
  }

  async updatePlan(id: string, dto: UpdatePlanDto, actorUserId: string): Promise<PlanResponseDto> {
    await this.getPlanRowOrThrow(id);

    if (dto.name) {
      const conflict = await this.prisma.plan.findUnique({ where: { name: dto.name } });
      if (conflict && conflict.id !== id) {
        throw new ConflictException('A plan with this name already exists');
      }
    }

    const plan = await this.prisma.$transaction(async (tx) => {
      await tx.plan.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          price: dto.price,
          currency: dto.currency,
          billingInterval: dto.billingInterval,
          maxDoctors: dto.maxDoctors,
          maxStaff: dto.maxStaff,
          maxPatients: dto.maxPatients,
          maxBranches: dto.maxBranches,
          trialDays: dto.trialDays,
        },
      });

      // Full replace, same convention as ClinicsService.setWorkingHours —
      // only when the caller actually sent `features`, so a PATCH that
      // doesn't mention features never wipes the existing set.
      if (dto.features !== undefined) {
        await tx.planFeature.deleteMany({ where: { planId: id } });
        if (dto.features.length > 0) {
          await tx.planFeature.createMany({
            data: dto.features.map((key) => ({ planId: id, key })),
          });
        }
      }

      return tx.plan.findUniqueOrThrow({ where: { id }, include: PLAN_WITH_FEATURES_INCLUDE });
    });

    await this.auditService.record({
      clinicId: null,
      actorUserId,
      actorType: 'PLATFORM_USER',
      entity: 'Plan',
      entityId: id,
      action: 'UPDATE',
      changedFields: Object.keys(dto).join(','),
    });

    return toPlanResponseDto(plan);
  }

  private async setPlanStatus(
    id: string,
    status: PlanLifecycleStatus,
    action: string,
    actorUserId: string,
  ): Promise<PlanResponseDto> {
    await this.getPlanRowOrThrow(id);
    const plan = await this.prisma.plan.update({
      where: { id },
      data: { status },
      include: PLAN_WITH_FEATURES_INCLUDE,
    });

    await this.auditService.record({
      clinicId: null,
      actorUserId,
      actorType: 'PLATFORM_USER',
      entity: 'Plan',
      entityId: id,
      action,
    });

    return toPlanResponseDto(plan);
  }

  async activatePlan(id: string, actorUserId: string): Promise<PlanResponseDto> {
    return this.setPlanStatus(id, 'ACTIVE', 'ACTIVATE', actorUserId);
  }

  async deactivatePlan(id: string, actorUserId: string): Promise<PlanResponseDto> {
    return this.setPlanStatus(id, 'INACTIVE', 'DEACTIVATE', actorUserId);
  }
}
