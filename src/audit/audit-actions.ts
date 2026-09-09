/**
 * Reusable `action` string constants for AuditService.record() calls,
 * grouped by module (Phase 1F). Not exhaustive of every AuditLog.action
 * value in the codebase — modules wired up in earlier phases (billing,
 * documents, clinics, roles, staff) keep their own established strings
 * (e.g. 'invoice.created', 'UPDATE') rather than being renamed here, to
 * avoid a disruptive, purely-cosmetic churn across already-shipped call
 * sites and their tests. New call sites in this phase, and any future
 * one, should add their constant here instead of inlining a string.
 */
export const AuditActions = {
  PATIENT_CREATED: 'patient.created',
  PATIENT_VIEWED: 'patient.viewed',
  PATIENT_UPDATED: 'patient.updated',
  PATIENT_ACTIVATED: 'patient.activated',
  PATIENT_DEACTIVATED: 'patient.deactivated',
  PATIENT_ARCHIVED: 'patient.archived',
  PATIENT_RESTORED: 'patient.restored',
  PATIENT_DUPLICATE_OVERRIDDEN: 'patient.duplicate_overridden',
  PATIENT_TIMELINE_VIEWED: 'patient.timeline_viewed',

  DOCTOR_CREATED: 'doctor.created',
  DOCTOR_VIEWED: 'doctor.viewed',
  DOCTOR_UPDATED: 'doctor.updated',
  // Kept for any historical AuditLog rows written before DOCTOR_ACTIVATED/
  // DOCTOR_DEACTIVATED existed — no longer written by DoctorsService.
  DOCTOR_STATUS_CHANGED: 'doctor.status_changed',
  DOCTOR_ACTIVATED: 'doctor.activated',
  DOCTOR_DEACTIVATED: 'doctor.deactivated',

  APPOINTMENT_CREATED: 'appointment.created',
  APPOINTMENT_UPDATED: 'appointment.updated',
  APPOINTMENT_RESCHEDULED: 'appointment.rescheduled',
  APPOINTMENT_CANCELLED: 'appointment.cancelled',
  APPOINTMENT_CHECKED_IN: 'appointment.checked_in',
  APPOINTMENT_WALK_IN_CREATED: 'appointment.walk_in_created',
  APPOINTMENT_CONFIRMED: 'appointment.confirmed',
  APPOINTMENT_WAITING: 'appointment.waiting',
  APPOINTMENT_STARTED: 'appointment.started',
  APPOINTMENT_COMPLETED: 'appointment.completed',
  APPOINTMENT_NO_SHOW: 'appointment.no_show',

  // Queue-only operations (2026-09-09 upgrade) — transitions that also
  // change Appointment.status (start/complete/no-show, called via
  // AppointmentsService from QueueService) are still audited under the
  // APPOINTMENT_* actions above, not duplicated here.
  QUEUE_TOKEN_GENERATED: 'queue.token_generated',
  QUEUE_CALLED: 'queue.called',
  QUEUE_RECALLED: 'queue.recalled',
  QUEUE_SKIPPED: 'queue.skipped',

  CONSULTATION_CREATED: 'consultation.created',
  CONSULTATION_VIEWED: 'consultation.viewed',
  CONSULTATION_UPDATED: 'consultation.updated',
  CONSULTATION_COMPLETED: 'consultation.completed',
  // Clinical Record upgrade (docs/DATABASE.md §16).
  CONSULTATION_AMENDED: 'consultation.amended',

  DIAGNOSIS_CREATED: 'diagnosis.created',
  DIAGNOSIS_DELETED: 'diagnosis.deleted',

  INVESTIGATION_ORDER_CREATED: 'investigation_order.created',
  INVESTIGATION_ORDER_VIEWED: 'investigation_order.viewed',
  INVESTIGATION_ORDER_CANCELLED: 'investigation_order.cancelled',

  PRESCRIPTION_CREATED: 'prescription.created',
  PRESCRIPTION_VIEWED: 'prescription.viewed',
  PRESCRIPTION_UPDATED: 'prescription.updated',
  PRESCRIPTION_FINALIZED: 'prescription.finalized',
  PRESCRIPTION_AMENDED: 'prescription.amended',

  PHARMACY_PURCHASE_RECORDED: 'pharmacy.purchase_recorded',
  PHARMACY_STOCK_ADJUSTED: 'pharmacy.stock_adjusted',
  PHARMACY_DISPENSED: 'pharmacy.dispensed',

  USER_CREATED: 'user.created',
  USER_ROLE_CHANGED: 'user.role_changed',
  USER_DEACTIVATED: 'user.deactivated',

  PASSWORD_CHANGED: 'user.password_changed',
  PASSWORD_RESET_REQUESTED: 'user.password_reset_requested',
  PASSWORD_RESET_COMPLETED: 'user.password_reset_completed',
} as const;
