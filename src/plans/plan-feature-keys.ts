/**
 * Fixed catalog of feature keys a Plan may grant (SA-06,
 * docs/SUPER_ADMIN_ARCHITECTURE.md §6.5/§6.7). Validated against here
 * rather than accepted as free text, so `PlanFeature.key` never drifts into
 * an uncontrolled value. Distinct from the global feature-flag system
 * (SA-07, not built here) — this list only says what a plan can include.
 */
export const PLAN_FEATURE_KEYS = [
  'AI_SCRIBE',
  'WHATSAPP',
  'ABDM',
  'ONLINE_PAYMENT',
  'TELECONSULTATION',
  'ADVANCED_ANALYTICS',
  'API_ACCESS',
] as const;

export type PlanFeatureKey = (typeof PLAN_FEATURE_KEYS)[number];
