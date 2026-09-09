/**
 * Shape returned to the client. `plan` is the minimal set a subscription
 * list/detail view needs (name/price/billingInterval) — not the full
 * `PlanResponseDto` (features/limits), which the caller can fetch
 * separately from `/super-admin/plans/:id` if needed. `clinic` is only
 * populated on the cross-clinic list endpoint (`SubscriptionsService.
 * listCurrentSubscriptions`); per-clinic endpoints omit it since the
 * caller already addressed the clinic by `:clinicId`.
 */
export interface SubscriptionResponseDto {
  id: string;
  clinicId: string;
  clinic: { id: string; name: string } | null;
  planId: string;
  plan: { id: string; name: string; price: string; currency: string; billingInterval: string };
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEndsAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  supersededAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
