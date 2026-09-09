import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ClinicsService } from '../clinics/clinics.service';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import type { BillingInterval } from '../plans/dto/create-plan.dto';
import { PlansService } from '../plans/plans.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AssignSubscriptionDto } from './dto/assign-subscription.dto';
import type { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import type { ChangePlanDto } from './dto/change-plan.dto';
import type { QuerySubscriptionsDto } from './dto/query-subscriptions.dto';
import type { SubscriptionResponseDto } from './dto/subscription-response.dto';
import {
  SUBSCRIPTION_WITH_PLAN_INCLUDE,
  toCurrentPlanLimits,
  toSubscriptionResponseDto,
  type CurrentPlanLimits,
  type SubscriptionWithPlan,
} from './subscription-mapping.util';
import { addBillingInterval, addDays } from './subscription-period.util';

/** Statuses that mean "this row is the clinic's live subscription record". */
const NON_TERMINAL_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'];

/**
 * Super Admin clinic-subscription management (SA-07,
 * docs/SUPER_ADMIN_ARCHITECTURE.md §6.6): connects a `Clinic` to a `Plan`.
 * No `isCurrent` flag on the model — exactly one non-SUPERSEDED
 * `Subscription` row exists per clinic at a time, an invariant this service
 * alone maintains (assign/changePlan are the only writers of new rows).
 * "Current subscription" is therefore just "the clinic's one non-SUPERSEDED
 * row"; full history is every row for that `clinicId`, oldest superseded
 * rows included, never overwritten.
 *
 * Every mutation records an `AuditLog` entry (clinicId: the *target*
 * clinic, actorType: PLATFORM_USER) — same pattern as PlansService/
 * ClinicsService's Super Admin write paths.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clinicsService: ClinicsService,
    private readonly plansService: PlansService,
    private readonly auditService: AuditService,
  ) {}

  private async assertClinicExists(clinicId: string): Promise<void> {
    await this.clinicsService.getClinicById(clinicId);
  }

  private async getActivePlanOrThrow(planId: string) {
    const plan = await this.plansService.getPlanById(planId);
    if (plan.status !== 'ACTIVE') {
      throw new ConflictException('Cannot subscribe a clinic to an inactive plan');
    }
    return plan;
  }

  private async getCurrentRowOrThrow(clinicId: string): Promise<SubscriptionWithPlan> {
    const current = await this.prisma.subscription.findFirst({
      where: { clinicId, status: { not: 'SUPERSEDED' } },
      orderBy: { createdAt: 'desc' },
      include: SUBSCRIPTION_WITH_PLAN_INCLUDE,
    });
    if (!current) throw new NotFoundException('No subscription found for this clinic');
    return current;
  }

  async getCurrentSubscription(clinicId: string): Promise<SubscriptionResponseDto> {
    await this.assertClinicExists(clinicId);
    return toSubscriptionResponseDto(await this.getCurrentRowOrThrow(clinicId));
  }

  /**
   * Current subscription + plan *limits* for one clinic (SA-09 usage-vs-
   * limit check) — `SubscriptionResponseDto`/`toSubscriptionResponseDto`
   * deliberately omit `Plan.maxDoctors/maxStaff/maxPatients` (see that DTO's
   * doc comment), so usage reporting needs this separate raw accessor
   * instead of the client-facing mapper. Returns `null` rather than
   * throwing when a clinic has no current subscription — "no plan" is a
   * valid, displayable state for usage reporting, not an error.
   */
  async getCurrentPlanLimits(clinicId: string): Promise<CurrentPlanLimits | null> {
    const row = await this.prisma.subscription.findFirst({
      where: { clinicId, status: { not: 'SUPERSEDED' } },
      orderBy: { createdAt: 'desc' },
      include: SUBSCRIPTION_WITH_PLAN_INCLUDE,
    });
    return row ? toCurrentPlanLimits(row) : null;
  }

  /**
   * Every clinic's current subscription + plan limits in one query (SA-09
   * usage overview) — not paginated here: `UsageService` needs the full set
   * to compute over-limit status across every clinic before paginating,
   * same "compute over the whole small cross-tenant table, not per-row"
   * reasoning as `listCurrentSubscriptions`'s own count/list pair. Bounded
   * by the number of clinics on the platform (a global catalog, not a
   * per-clinic table), not by any tenant-scoped data volume.
   */
  async listAllCurrentPlanLimits(filter: {
    planId?: string;
    search?: string;
  }): Promise<CurrentPlanLimits[]> {
    const rows = await this.prisma.subscription.findMany({
      where: {
        status: { not: 'SUPERSEDED' },
        ...(filter.planId ? { planId: filter.planId } : {}),
        ...(filter.search ? { clinic: { name: { contains: filter.search } } } : {}),
      },
      include: { ...SUBSCRIPTION_WITH_PLAN_INCLUDE, clinic: { select: { id: true, name: true } } },
    });
    return rows.map((row) => toCurrentPlanLimits(row, row.clinic));
  }

  async getSubscriptionHistory(clinicId: string): Promise<SubscriptionResponseDto[]> {
    await this.assertClinicExists(clinicId);
    const rows = await this.prisma.subscription.findMany({
      where: { clinicId },
      orderBy: { createdAt: 'desc' },
      include: SUBSCRIPTION_WITH_PLAN_INCLUDE,
    });
    return rows.map((row) => toSubscriptionResponseDto(row));
  }

  async listCurrentSubscriptions(
    query: QuerySubscriptionsDto,
  ): Promise<PaginatedResult<SubscriptionResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.SubscriptionWhereInput = {
      status: query.status ?? { not: 'SUPERSEDED' },
      ...(query.planId ? { planId: query.planId } : {}),
    };

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';
    const orderBy: Prisma.SubscriptionOrderByWithRelationInput =
      sortBy === 'currentPeriodEnd' ? { currentPeriodEnd: sortOrder } : { createdAt: sortOrder };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.subscription.count({ where }),
      this.prisma.subscription.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: SUBSCRIPTION_WITH_PLAN_INCLUDE,
      }),
    ]);

    const clinicIds = [...new Set(rows.map((row) => row.clinicId))];
    const clinics = clinicIds.length
      ? await this.prisma.clinic.findMany({
          where: { id: { in: clinicIds } },
          select: { id: true, name: true },
        })
      : [];
    const clinicById = new Map(clinics.map((clinic) => [clinic.id, clinic]));

    return {
      data: rows.map((row) => toSubscriptionResponseDto(row, clinicById.get(row.clinicId))),
      meta: { total, page, pageSize },
    };
  }

  /** Shared by assign/changePlan: compute the new row's period/trial fields from the plan + DTO. */
  private buildNewRowData(
    clinicId: string,
    planId: string,
    plan: { billingInterval: string; trialDays: number | null },
    dto: AssignSubscriptionDto,
  ): Prisma.SubscriptionUncheckedCreateInput {
    const currentPeriodStart = dto.currentPeriodStart
      ? new Date(dto.currentPeriodStart)
      : new Date();
    const currentPeriodEnd = dto.currentPeriodEnd
      ? new Date(dto.currentPeriodEnd)
      : addBillingInterval(currentPeriodStart, plan.billingInterval as BillingInterval);
    const hasTrial = !!plan.trialDays && plan.trialDays > 0;

    return {
      clinicId,
      planId,
      status: hasTrial ? 'TRIAL' : 'ACTIVE',
      currentPeriodStart,
      currentPeriodEnd,
      trialEndsAt: hasTrial ? addDays(currentPeriodStart, plan.trialDays as number) : null,
    };
  }

  async assignSubscription(
    clinicId: string,
    dto: AssignSubscriptionDto,
    actorUserId: string,
  ): Promise<SubscriptionResponseDto> {
    await this.assertClinicExists(clinicId);
    const plan = await this.getActivePlanOrThrow(dto.planId);

    const existing = await this.prisma.subscription.findFirst({
      where: { clinicId, status: { in: NON_TERMINAL_STATUSES } },
    });
    if (existing) {
      throw new ConflictException(
        'Clinic already has an active subscription — use change-plan instead',
      );
    }

    const created = await this.prisma.subscription.create({
      data: this.buildNewRowData(clinicId, dto.planId, plan, dto),
      include: SUBSCRIPTION_WITH_PLAN_INCLUDE,
    });

    await this.auditService.record({
      clinicId,
      actorUserId,
      actorType: 'PLATFORM_USER',
      entity: 'Subscription',
      entityId: created.id,
      action: 'ASSIGN',
      changedFields: `planId:${dto.planId}`,
    });

    return toSubscriptionResponseDto(created);
  }

  async changePlan(
    clinicId: string,
    dto: ChangePlanDto,
    actorUserId: string,
  ): Promise<SubscriptionResponseDto> {
    await this.assertClinicExists(clinicId);
    const plan = await this.getActivePlanOrThrow(dto.planId);
    const current = await this.getCurrentRowOrThrow(clinicId);

    if (current.planId === dto.planId) {
      throw new ConflictException('Clinic is already subscribed to this plan');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: current.id },
        data: { status: 'SUPERSEDED', supersededAt: new Date() },
      });

      return tx.subscription.create({
        data: this.buildNewRowData(clinicId, dto.planId, plan, dto),
        include: SUBSCRIPTION_WITH_PLAN_INCLUDE,
      });
    });

    await this.auditService.record({
      clinicId,
      actorUserId,
      actorType: 'PLATFORM_USER',
      entity: 'Subscription',
      entityId: updated.id,
      action: 'CHANGE_PLAN',
      changedFields: `planId:${current.planId}->${dto.planId}`,
    });

    return toSubscriptionResponseDto(updated);
  }

  private async transitionStatus(
    clinicId: string,
    allowedFrom: string[],
    toStatus: string,
    action: string,
    actorUserId: string,
    extraData?: Prisma.SubscriptionUpdateInput,
  ): Promise<SubscriptionResponseDto> {
    await this.assertClinicExists(clinicId);
    const current = await this.getCurrentRowOrThrow(clinicId);

    if (!allowedFrom.includes(current.status)) {
      throw new ConflictException(
        `Cannot transition subscription from ${current.status} to ${toStatus}`,
      );
    }

    const updated = await this.prisma.subscription.update({
      where: { id: current.id },
      data: { status: toStatus, ...extraData },
      include: SUBSCRIPTION_WITH_PLAN_INCLUDE,
    });

    await this.auditService.record({
      clinicId,
      actorUserId,
      actorType: 'PLATFORM_USER',
      entity: 'Subscription',
      entityId: updated.id,
      action,
    });

    return toSubscriptionResponseDto(updated);
  }

  async activateSubscription(
    clinicId: string,
    actorUserId: string,
  ): Promise<SubscriptionResponseDto> {
    return this.transitionStatus(
      clinicId,
      ['TRIAL', 'PAST_DUE', 'SUSPENDED'],
      'ACTIVE',
      'ACTIVATE',
      actorUserId,
    );
  }

  async deactivateSubscription(
    clinicId: string,
    actorUserId: string,
  ): Promise<SubscriptionResponseDto> {
    return this.transitionStatus(
      clinicId,
      ['TRIAL', 'ACTIVE', 'PAST_DUE'],
      'SUSPENDED',
      'DEACTIVATE',
      actorUserId,
    );
  }

  async cancelSubscription(
    clinicId: string,
    dto: CancelSubscriptionDto,
    actorUserId: string,
  ): Promise<SubscriptionResponseDto> {
    return this.transitionStatus(
      clinicId,
      ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'],
      'CANCELLED',
      'CANCEL',
      actorUserId,
      { cancelledAt: new Date(), cancellationReason: dto.cancellationReason ?? null },
    );
  }
}
