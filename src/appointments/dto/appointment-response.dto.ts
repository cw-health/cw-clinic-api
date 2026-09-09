import type { AppointmentStatus, AppointmentType } from './query-appointments.dto';

export interface AppointmentResponseDto {
  id: string;
  clinicId: string;
  doctorId: string;
  doctorName: string;
  patientId: string;
  patientName: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  type: AppointmentType;
  reasonForVisit: string | null;
  notes: string | null;
  createdByUserId: string;
  confirmedAt: Date | null;
  checkedInAt: Date | null;
  consultationStartedAt: Date | null;
  completedAt: Date | null;
  noShowAt: Date | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AvailableSlotDto {
  startsAt: Date;
  endsAt: Date;
}
