export interface PatientResponseDto {
  id: string;
  clinicId: string;
  userId: string | null;
  mrn: string;
  firstName: string;
  lastName: string;
  gender: string | null;
  dateOfBirth: Date | null;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  knownAllergies: string | null;
  chronicConditions: string | null;
  /** One of: ACTIVE, INACTIVE, ARCHIVED. */
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** One of: PHONE, EMAIL, NAME_DOB, MRN — which rule(s) matched an existing patient. */
export type DuplicateMatchReason = 'PHONE' | 'EMAIL' | 'NAME_DOB' | 'MRN';

export interface DuplicatePatientCandidate {
  patient: PatientResponseDto;
  matchedOn: DuplicateMatchReason[];
}
