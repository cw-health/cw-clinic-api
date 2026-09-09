import type { Clinic, Prisma } from '@prisma/client';
import type { ClinicAdminResponseDto } from './dto/clinic-admin-response.dto';
import type { CreateClinicDto } from './dto/create-clinic.dto';

export type ClinicWithPrimaryAdmin = Clinic & {
  primaryAdminUser: { id: string; firstName: string; lastName: string; email: string } | null;
};

/** Shared include shape for every read that needs the primary-admin summary (SA-03.1). */
export const CLINIC_WITH_PRIMARY_ADMIN_INCLUDE = {
  primaryAdminUser: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.ClinicInclude;

/** Fields the deterministic onboarding-completeness checklist reads — a subset of Clinic, so callers can pass either a full row or the fields about to be written. */
export interface OnboardingChecklistInput {
  contactEmail: string | null | undefined;
  addressLine1: string | null | undefined;
  city: string | null | undefined;
  country: string | null | undefined;
  legalEntityType: string | null | undefined;
  registrationApplicable: boolean | undefined;
  registrationNumber: string | null | undefined;
}

export interface OnboardingResult {
  onboardingStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  onboardingCompletedAt: Date | null;
  missingRequiredFields: string[];
}

/**
 * Deterministic onboarding-completeness checklist (SA-03.1) — no workflow
 * engine, just a fixed set of required-for-completion facts recomputed
 * after every clinic-registry write. `registrationNumber` is only required
 * when `registrationApplicable` is true, so a clinic legitimately without
 * one (rather than one that simply hasn't provided it yet) isn't blocked.
 */
export function computeOnboarding(
  clinic: OnboardingChecklistInput,
  hasPrimaryAdmin: boolean,
  previous: { onboardingStatus: string; onboardingCompletedAt: Date | null },
): OnboardingResult {
  const checks: Array<{ field: string; present: boolean }> = [
    { field: 'contactEmail', present: !!clinic.contactEmail },
    { field: 'address', present: !!(clinic.addressLine1 && clinic.city && clinic.country) },
    { field: 'legalEntityType', present: !!clinic.legalEntityType },
    {
      field: 'registrationNumber',
      present: clinic.registrationApplicable === false || !!clinic.registrationNumber,
    },
    { field: 'primaryAdmin', present: hasPrimaryAdmin },
  ];

  const missingRequiredFields = checks.filter((c) => !c.present).map((c) => c.field);

  const onboardingStatus: OnboardingResult['onboardingStatus'] =
    missingRequiredFields.length === 0
      ? 'COMPLETED'
      : missingRequiredFields.length === checks.length
        ? 'NOT_STARTED'
        : 'IN_PROGRESS';

  const onboardingCompletedAt =
    onboardingStatus === 'COMPLETED' ? (previous.onboardingCompletedAt ?? new Date()) : null;

  return { onboardingStatus, onboardingCompletedAt, missingRequiredFields };
}

/**
 * Overlays only the *defined* keys of `dto` onto `existing` — a plain
 * `{ ...existing, ...dto }` spread is wrong here because an unset optional
 * field on a class-validator DTO instance is still an own key with value
 * `undefined`, which would silently blank out `existing`'s real value in
 * the merged object (Prisma itself correctly ignores `undefined` on a
 * write, but a hand-rolled JS spread does not — this bit the onboarding
 * checklist in SA-03.1's first pass, computing a stale/wrong status
 * whenever a PATCH omitted a field the checklist reads).
 */
export function overlayDefined<T extends object>(existing: T, dto: Partial<T>): T {
  const merged = { ...existing };
  for (const key of Object.keys(dto) as (keyof T)[]) {
    if (dto[key] !== undefined) merged[key] = dto[key];
  }
  return merged;
}

/** Converts CreateClinicDto's date strings to Date for Prisma; omits the nested `primaryAdmin` (handled separately, transactionally). */
export function toClinicCreateData(
  dto: CreateClinicDto,
): Omit<Prisma.ClinicUncheckedCreateInput, 'id'> {
  const { primaryAdmin: _primaryAdmin, registrationDate, registrationExpiryDate, ...rest } = dto;
  return {
    ...rest,
    timezone: dto.timezone ?? 'UTC',
    defaultAppointmentDurationMinutes: dto.defaultAppointmentDurationMinutes ?? 15,
    registrationDate: registrationDate ? new Date(registrationDate) : undefined,
    registrationExpiryDate: registrationExpiryDate ? new Date(registrationExpiryDate) : undefined,
  };
}

/**
 * Converts a clinic-profile-update DTO's date strings to `Date` for Prisma.
 * Generic over the caller's exact DTO shape (`AdminUpdateClinicDto`,
 * `UpdateClinicDto`, or one of the onboarding-step DTOs, which are all
 * whitelisted subsets of the same field set) — every one of them only ever
 * carries these two date-typed fields as strings.
 */
export function toClinicUpdateData<
  T extends { registrationDate?: string; registrationExpiryDate?: string },
>(dto: T): Prisma.ClinicUncheckedUpdateInput {
  const { registrationDate, registrationExpiryDate, ...rest } = dto;
  return {
    ...rest,
    ...(registrationDate !== undefined && { registrationDate: new Date(registrationDate) }),
    ...(registrationExpiryDate !== undefined && {
      registrationExpiryDate: new Date(registrationExpiryDate),
    }),
  };
}

export function toClinicAdminResponseDto(clinic: ClinicWithPrimaryAdmin): ClinicAdminResponseDto {
  const onboarding = computeOnboarding(clinic, !!clinic.primaryAdminUser, clinic);
  return {
    id: clinic.id,
    name: clinic.name,
    slug: clinic.slug,
    status: clinic.status,
    facilityType: clinic.facilityType,
    legalName: clinic.legalName,
    legalEntityType: clinic.legalEntityType,
    description: clinic.description,
    registrationApplicable: clinic.registrationApplicable,
    registrationNumber: clinic.registrationNumber,
    registrationAuthority: clinic.registrationAuthority,
    registrationDate: clinic.registrationDate,
    registrationExpiryDate: clinic.registrationExpiryDate,
    taxIdentifierType: clinic.taxIdentifierType,
    taxIdentifierValue: clinic.taxIdentifierValue,
    contactEmail: clinic.contactEmail,
    contactPhone: clinic.contactPhone,
    alternatePhone: clinic.alternatePhone,
    website: clinic.website,
    addressLine1: clinic.addressLine1,
    addressLine2: clinic.addressLine2,
    city: clinic.city,
    state: clinic.state,
    postalCode: clinic.postalCode,
    country: clinic.country,
    timezone: clinic.timezone,
    currency: clinic.currency,
    defaultAppointmentDurationMinutes: clinic.defaultAppointmentDurationMinutes,
    onboardingStatus: clinic.onboardingStatus,
    onboardingCompletedAt: clinic.onboardingCompletedAt,
    missingRequiredFields: onboarding.missingRequiredFields,
    primaryAdmin: clinic.primaryAdminUser,
    createdAt: clinic.createdAt,
    updatedAt: clinic.updatedAt,
  };
}
