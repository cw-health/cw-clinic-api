import type { Plan, PlanFeature } from '@prisma/client';
import type { PlanResponseDto } from './dto/plan-response.dto';

export const PLAN_WITH_FEATURES_INCLUDE = { features: true } as const;

export type PlanWithFeatures = Plan & { features: PlanFeature[] };

export function toPlanResponseDto(plan: PlanWithFeatures): PlanResponseDto {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    status: plan.status,
    price: plan.price.toString(),
    currency: plan.currency,
    billingInterval: plan.billingInterval,
    maxDoctors: plan.maxDoctors,
    maxStaff: plan.maxStaff,
    maxPatients: plan.maxPatients,
    maxBranches: plan.maxBranches,
    trialDays: plan.trialDays,
    features: plan.features.map((f) => f.key),
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}
