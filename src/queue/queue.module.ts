import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { AuditModule } from '../audit/audit.module';
import { ClinicsModule } from '../clinics/clinics.module';
import { DoctorsModule } from '../doctors/doctors.module';
import { QueueController } from './queue.controller';
import { QueueService } from './queue.service';

@Module({
  // ClinicsModule/AuditModule newly imported for this upgrade (queue now
  // owns its own QueueEntry table, so it needs the clinic's timezone
  // directly — same as AppointmentsModule — and records its own audit
  // events for the queue-only operations that don't already go through an
  // AppointmentsService transition).
  imports: [AppointmentsModule, DoctorsModule, ClinicsModule, AuditModule],
  controllers: [QueueController],
  providers: [QueueService],
})
export class QueueModule {}
