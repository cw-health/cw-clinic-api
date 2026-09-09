/**
 * Allowed `Clinic.facilityType` values (Phase 1A onboarding) — what kind of
 * care facility this is, distinct from `legalEntityType` (the business
 * structure). "OTHER" covers any facility kind outside this list, same
 * not-jurisdiction-specific convention as `legal-entity-type.ts`.
 */
export const FACILITY_TYPES = [
  'HOSPITAL',
  'CLINIC',
  'DIAGNOSTIC_CENTER',
  'POLYCLINIC',
  'DENTAL_CLINIC',
  'OTHER',
] as const;

export type FacilityType = (typeof FACILITY_TYPES)[number];
