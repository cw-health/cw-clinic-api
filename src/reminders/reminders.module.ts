import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { ConsultationsModule } from '../consultations/consultations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RemindersService } from './reminders.service';

/**
 * Composition module (docs/ROADMAP.md Phase 8), same pattern as
 * QueueModule: holds no Prisma access of its own, only orchestrates the
 * AppointmentsService/ConsultationsService/NotificationsService it imports.
 * Kept separate from NotificationsModule to avoid a circular module
 * dependency — AppointmentsModule already imports NotificationsModule.
 */
@Module({
  imports: [AppointmentsModule, ConsultationsModule, NotificationsModule],
  providers: [RemindersService],
})
export class RemindersModule {}
