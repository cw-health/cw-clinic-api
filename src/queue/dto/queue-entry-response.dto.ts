import type { AppointmentStatus } from '../../appointments/dto/query-appointments.dto';

/** QueueEntry.status — see the doc comment on `model QueueEntry` in schema.prisma. */
export const QUEUE_ENTRY_STATUSES = [
  'WAITING',
  'CALLED',
  'IN_CONSULTATION',
  'COMPLETED',
  'SKIPPED',
  'NO_SHOW',
] as const;
export type QueueEntryStatus = (typeof QUEUE_ENTRY_STATUSES)[number];

export interface QueueEntryResponseDto {
  id: string;
  clinicId: string;
  doctorId: string;
  doctorName: string;
  appointmentId: string;
  patientId: string;
  patientName: string;
  /** Clinic-local calendar date this token belongs to, `yyyy-MM-dd`. */
  queueDate: string;
  tokenNumber: number;
  /**
   * 1-based rank among today's currently-WAITING entries for this doctor,
   * ordered by tokenNumber — `null` once the entry has left the waiting
   * line (CALLED or later). Computed at read time, never stored — see the
   * model doc comment.
   */
  position: number | null;
  status: QueueEntryStatus;
  /** The underlying Appointment's own lifecycle status — see queue.service.ts's module doc comment. */
  appointmentStatus: AppointmentStatus;
  calledAt: Date | null;
  calledCount: number;
  consultationStartedAt: Date | null;
  completedAt: Date | null;
  skippedAt: Date | null;
  noShowAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
