/** Super Admin clinic-registry response shape (SA-03, extended SA-03.1) — see ClinicsService's toClinicAdminResponseDto. */
export interface ClinicAdminResponseDto {
  id: string;
  name: string;
  slug: string;
  status: string;

  facilityType: string | null;
  legalName: string | null;
  legalEntityType: string | null;
  description: string | null;

  registrationApplicable: boolean;
  registrationNumber: string | null;
  registrationAuthority: string | null;
  registrationDate: Date | null;
  registrationExpiryDate: Date | null;

  taxIdentifierType: string | null;
  taxIdentifierValue: string | null;

  contactEmail: string | null;
  contactPhone: string | null;
  alternatePhone: string | null;
  website: string | null;

  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;

  timezone: string;
  currency: string;
  defaultAppointmentDurationMinutes: number;

  onboardingStatus: string;
  onboardingCompletedAt: Date | null;
  /** Field names still required to reach onboardingStatus COMPLETED — drives the frontend's "Onboarding incomplete" banner. */
  missingRequiredFields: string[];

  primaryAdmin: { id: string; firstName: string; lastName: string; email: string } | null;

  createdAt: Date;
  updatedAt: Date;
}
