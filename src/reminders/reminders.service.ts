import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { addDays, addHours, addMinutes, startOfDay } from 'date-fns';
import { AppointmentsService, NO_SHOW_GRACE_MINUTES } from '../appointments/appointments.service';
import { ConsultationsService } from '../consultations/consultations.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Hourly reminder scan (docs/ROADMAP.md Phase 8): emits
 * APPOINTMENT_REMINDER for appointments starting in the next ~24h and
 * FOLLOW_UP_REMINDER for consultations whose followUpDate is tomorrow.
 * Idempotent via NotificationsService.existsForEntity — a notification is
 * only ever created once per (clinicId, type, relatedEntityId), so running
 * this every hour never double-notifies the same appointment/consultation.
 *
 * Also runs the automatic no-show sweep (`markNoShows`) — same cron
 * infrastructure, same cross-tenant-scan shape, added here rather than a
 * new module (this module already exists purely to orchestrate
 * time-driven Appointment/Consultation side effects).
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly consultationsService: ConsultationsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sendAppointmentReminders(): Promise<void> {
    const now = new Date();
    const appointments = await this.appointmentsService.findUpcomingForReminder(
      now,
      addHours(now, 24),
    );

    for (const appointment of appointments) {
      if (!appointment.patientUserId) continue;
      const already = await this.notificationsService.existsForEntity(
        appointment.clinicId,
        'APPOINTMENT_REMINDER',
        appointment.id,
      );
      if (already) continue;

      await this.notificationsService
        .create(
          appointment.clinicId,
          appointment.patientUserId,
          'APPOINTMENT_REMINDER',
          'Appointment reminder',
          `You have an upcoming appointment on ${appointment.startsAt.toISOString()}.`,
          'Appointment',
          appointment.id,
        )
        .catch((error: unknown) =>
          this.logger.error(`Failed to create appointment reminder: ${String(error)}`),
        );
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async sendFollowUpReminders(): Promise<void> {
    const tomorrow = startOfDay(addDays(new Date(), 1));
    const consultations = await this.consultationsService.findFollowUpsDue(
      tomorrow,
      addDays(tomorrow, 1),
    );

    for (const consultation of consultations) {
      if (!consultation.patientUserId) continue;
      const already = await this.notificationsService.existsForEntity(
        consultation.clinicId,
        'FOLLOW_UP_REMINDER',
        consultation.id,
      );
      if (already) continue;

      await this.notificationsService
        .create(
          consultation.clinicId,
          consultation.patientUserId,
          'FOLLOW_UP_REMINDER',
          'Follow-up reminder',
          'You have a follow-up visit due tomorrow.',
          'Consultation',
          consultation.id,
        )
        .catch((error: unknown) =>
          this.logger.error(`Failed to create follow-up reminder: ${String(error)}`),
        );
    }
  }

  /**
   * Automatic no-show sweep: any SCHEDULED/CONFIRMED appointment whose
   * `startsAt` is more than NO_SHOW_GRACE_MINUTES in the past never got
   * checked in — auto-transition it to NO_SHOW via
   * AppointmentsService.autoMarkNoShow, which goes through the same
   * transitionStatus()/ALLOWED_TRANSITIONS chokepoint as a manual no-show.
   * Naturally idempotent: findOverdueForNoShow only ever matches
   * SCHEDULED/CONFIRMED rows, so once a row is marked NO_SHOW it drops out
   * of the next hour's scan on its own — no separate dedup check needed
   * (unlike the notification reminders above, this isn't creating a
   * notification row, it's a state transition that's already
   * self-excluding). Each row is `.catch()`-guarded so one appointment
   * that raced a manual transition in the meantime (ConflictException from
   * transitionStatus) never blocks the rest of the sweep.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async markNoShows(): Promise<void> {
    const cutoff = addMinutes(new Date(), -NO_SHOW_GRACE_MINUTES);
    const overdue = await this.appointmentsService.findOverdueForNoShow(cutoff);

    for (const appointment of overdue) {
      await this.appointmentsService
        .autoMarkNoShow(appointment.clinicId, appointment.id)
        .catch((error: unknown) =>
          this.logger.error(`Failed to auto-mark no-show: ${String(error)}`),
        );
    }
  }
}
