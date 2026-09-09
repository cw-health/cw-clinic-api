import type { DiagnosisType } from './create-diagnosis.dto';

export interface DiagnosisResponseDto {
  id: string;
  clinicId: string;
  consultationId: string;
  doctorId: string;
  type: DiagnosisType;
  description: string;
  icdCode: string | null;
  sortOrder: number;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}
