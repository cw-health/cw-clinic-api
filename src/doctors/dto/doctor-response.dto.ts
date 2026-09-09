export interface DoctorDepartmentSummaryDto {
  id: string;
  name: string;
  code: string;
  branchId: string;
  branchName: string;
  branchCode: string;
}

export interface DoctorBranchSummaryDto {
  id: string;
  name: string;
  code: string;
}

export interface DoctorResponseDto {
  id: string;
  clinicId: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  licenseNumber: string | null;
  qualification: string | null;
  bio: string | null;
  consultationFee: string | null;
  yearsOfExperience: number | null;
  appointmentDurationMinutes: number | null;
  status: string;
  specializations: { id: string; name: string }[];
  /** Departments this doctor is assigned to (Doctor <-> Department, Phase 1C), each carrying its own branch. */
  departments: DoctorDepartmentSummaryDto[];
  /** Branches derived from `departments`, de-duplicated — a doctor has no direct branchId column (see doc comment on model Doctor). */
  branches: DoctorBranchSummaryDto[];
  createdAt: Date;
  updatedAt: Date;
}
