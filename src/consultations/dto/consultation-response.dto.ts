export type ConsultationStatus = 'IN_PROGRESS' | 'COMPLETED';

export interface ConsultationResponseDto {
  id: string;
  clinicId: string;
  appointmentId: string;
  doctorId: string;
  doctorName: string;
  patientId: string;
  patientName: string;
  status: ConsultationStatus;

  chiefComplaint: string;
  symptoms: string | null;
  history: string | null;

  heightCm: number | null;
  weightKg: number | null;
  temperatureCelsius: number | null;
  pulseBpm: number | null;
  bloodPressureSystolic: number | null;
  bloodPressureDiastolic: number | null;
  respiratoryRate: number | null;
  spo2Percent: number | null;

  examination: string | null;
  diagnosis: string | null;
  investigations: string | null;
  treatment: string | null;
  advice: string | null;

  followUpDate: Date | null;
  followUpInstructions: string | null;

  notes: string | null;
  templateKey: string | null;
  customFields: string | null;

  createdByUserId: string;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
