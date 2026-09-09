import type { UsageResourceKey } from '../usage-resource-keys';

export interface UsageResourceDto {
  resource: UsageResourceKey;
  currentUsage: number;
  /** `null` = unlimited for this dimension (mirrors `Plan.max*` semantics). */
  limit: number | null;
  /** `null` when `limit` is `null` — utilization is meaningless against no cap. */
  utilizationPercent: number | null;
  overLimit: boolean;
}

/**
 * One clinic's usage-vs-limit summary (SA-09). `planId`/`planName`/
 * `subscriptionStatus` are `null` when the clinic has no current
 * subscription — a clinic without a plan has nothing to be over-limit
 * against, but is still worth surfacing (e.g. "not yet subscribed").
 */
export interface ClinicUsageSummaryDto {
  clinicId: string;
  clinicName: string | null;
  planId: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  resources: UsageResourceDto[];
  overLimitAny: boolean;
  /** Server time the counts were computed at — this is a live read, not a stored snapshot. */
  asOf: Date;
}
