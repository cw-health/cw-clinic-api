/**
 * Allowed `Clinic.legalEntityType` values (SA-03.1) — deliberately not
 * jurisdiction-specific: "OTHER" covers any structure outside this list,
 * so the product isn't hard-coded to one country's entity taxonomy.
 */
export const LEGAL_ENTITY_TYPES = [
  'INDIVIDUAL_PRACTITIONER',
  'PARTNERSHIP',
  'PRIVATE_COMPANY',
  'LLP',
  'TRUST',
  'SOCIETY',
  'OTHER',
] as const;

export type LegalEntityType = (typeof LEGAL_ENTITY_TYPES)[number];
