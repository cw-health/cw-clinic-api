export type PrescriptionStatus = 'DRAFT' | 'FINALIZED' | 'SUPERSEDED';

export interface PrescriptionItemResponseDto {
  id: string;
  medicineId: string;
  medicineName: string;
  dosage: string;
  frequency: string;
  duration: string;
  route: string | null;
  instructions: string | null;
  sortOrder: number;
}

export interface PrescriptionResponseDto {
  id: string;
  clinicId: string;
  consultationId: string;
  doctorId: string;
  doctorName: string;
  patientId: string;
  patientName: string;
  status: PrescriptionStatus;
  version: number;
  amendsId: string | null;
  notes: string | null;
  items: PrescriptionItemResponseDto[];
  createdByUserId: string;
  finalizedAt: Date | null;
  supersededAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
