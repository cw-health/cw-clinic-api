/**
 * Fixed catalog of usage resources Super Admin can compare against a
 * clinic's plan limits (SA-09, docs/SUPER_ADMIN_ARCHITECTURE.md §6.15).
 *
 * Deliberately just these three, not the full `Plan.max*` column set:
 * - DOCTORS  -> `Doctor` rows (active, non-deleted)
 * - STAFF    -> `ClinicMembership` rows (active) excluding the Doctor and
 *               Patient role templates — i.e. ClinicAdmin/FrontDesk/Billing
 * - PATIENTS -> `Patient` rows (active, non-deleted)
 *
 * `Plan.maxBranches` is intentionally excluded: no `Branch` (or equivalent)
 * resource exists anywhere in the schema today, so there is no usage count
 * to report it against — showing it would be a limit with no real data
 * behind it. Storage/AI-credit/API-call usage are excluded for the same
 * reason (no instrumentation exists yet; see architecture doc §6.15 Phase 2
 * / §21) — this list only covers dimensions that are both plan-limited
 * *and* already queryable from real data.
 */
export const USAGE_RESOURCE_KEYS = ['DOCTORS', 'STAFF', 'PATIENTS'] as const;
export type UsageResourceKey = (typeof USAGE_RESOURCE_KEYS)[number];
