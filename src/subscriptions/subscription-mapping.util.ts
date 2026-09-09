import type { Plan, Subscription } from '@prisma/client';
import type { SubscriptionResponseDto } from './dto/subscription-response.dto';

export const SUBSCRIPTION_WITH_PLAN_INCLUDE = { plan: true } as const;

export type SubscriptionWithPlan = Subscription & { plan: Plan };

/** Raw shape for usage-vs-limit reporting (SA-09) — see `SubscriptionsService.getCurrentPlanLimits`. */
export interface CurrentPlanLimits {
  clinicId: string;
  clinicName: string | null;
  subscriptionStatus: string;
  planId: string;
  planName: string;
  maxDoctors: number | null;
  maxStaff: number | null;
  maxPatients: number | null;
}

export function toCurrentPlanLimits(
  subscription: SubscriptionWithPlan,
  clinic?: { id: string; name: string } | null,
): CurrentPlanLimits {
  return {
    clinicId: subscription.clinicId,
    clinicName: clinic?.name ?? null,
    subscriptionStatus: subscription.status,
    planId: subscription.plan.id,
    planName: subscription.plan.name,
    maxDoctors: subscription.plan.maxDoctors,
    maxStaff: subscription.plan.maxStaff,
    maxPatients: subscription.plan.maxPatients,
  };
}

export function toSubscriptionResponseDto(
  subscription: SubscriptionWithPlan,
  clinic?: { id: string; name: string } | null,
): SubscriptionResponseDto {
  return {
    id: subscription.id,
    clinicId: subscription.clinicId,
    clinic: clinic ?? null,
    planId: subscription.planId,
    plan: {
      id: subscription.plan.id,
      name: subscription.plan.name,
      price: subscription.plan.price.toString(),
      currency: subscription.plan.currency,
      billingInterval: subscription.plan.billingInterval,
    },
    status: subscription.status,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    trialEndsAt: subscription.trialEndsAt,
    cancelledAt: subscription.cancelledAt,
    cancellationReason: subscription.cancellationReason,
    supersededAt: subscription.supersededAt,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
  };
}
