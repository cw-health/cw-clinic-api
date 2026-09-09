export const TIMELINE_EVENT_TYPES = [
  'APPOINTMENT',
  'CONSULTATION',
  'PRESCRIPTION',
  'INVOICE',
  'PAYMENT',
  'DOCUMENT',
] as const;
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

/**
 * One unified entry in a patient's timeline. Deliberately just a thin
 * projection of the source record (id/occurredAt/title/summary/status/
 * link) — the full record already has its own detail endpoint/page, this
 * never duplicates or stores that data, only points at it.
 */
export interface PatientTimelineEntryDto {
  type: TimelineEventType;
  id: string;
  occurredAt: Date;
  title: string;
  summary: string | null;
  status: string | null;
  /** Relative admin-app route to the full record, e.g. "/appointments/{id}". */
  link: string;
}
