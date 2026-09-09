import type { ClinicAdminResponseDto } from './clinic-admin-response.dto';

/** Fixed onboarding wizard step order (Phase 1A) — mirrors the product's 7-step flow (basic info -> legal -> address -> working hours -> primary admin -> review -> complete); REVIEW/COMPLETE aren't data-bearing steps here, so they're not in this list — `currentStep` reports them separately. */
export const ONBOARDING_STEP_KEYS = [
  'BASIC_INFO',
  'LEGAL_INFO',
  'ADDRESS',
  'WORKING_HOURS',
  'PRIMARY_ADMIN',
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number];

export interface OnboardingStepStatus {
  key: OnboardingStepKey;
  label: string;
  completed: boolean;
}

/**
 * Tenant-facing onboarding progress (Phase 1A) — read via
 * `GET /clinics/me/onboarding`, driving the wizard's step indicator and
 * "Review" screen. `onboardingStatus`/`missingRequiredFields` are the same
 * deterministic five-item checklist every clinic-registry write already
 * recomputes (see clinic-mapping.util.ts's `computeOnboarding`) — `steps`
 * is a superset for the wizard's UX (it also tracks `WORKING_HOURS`, which
 * is part of the flow but deliberately not a *required* field for
 * `onboardingStatus` — see the Clinic model's own doc comment on why that
 * checklist stays fixed).
 */
export interface OnboardingStatusResponseDto {
  onboardingStatus: string;
  onboardingCompletedAt: Date | null;
  missingRequiredFields: string[];
  steps: OnboardingStepStatus[];
  /** First incomplete step, or 'REVIEW' once every step above is complete. */
  currentStep: OnboardingStepKey | 'REVIEW';
  clinic: ClinicAdminResponseDto;
}
