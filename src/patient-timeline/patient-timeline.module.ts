import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { ConsultationsModule } from '../consultations/consultations.module';
import { DocumentsModule } from '../documents/documents.module';
import { PatientsModule } from '../patients/patients.module';
import { PrescriptionsModule } from '../prescriptions/prescriptions.module';
import { PatientTimelineController } from './patient-timeline.controller';
import { PatientTimelineService } from './patient-timeline.service';

/**
 * Aggregator module sitting "above" patients/appointments/consultations/
 * prescriptions/billing/documents — same shape as `usage.module.ts`. It
 * has to live outside `PatientsModule` itself: every one of those modules
 * already imports `PatientsModule` (to validate a patientId belongs to the
 * clinic), so `PatientsModule` importing any of them back would be a
 * circular dependency (docs/ARCHITECTURE.md §3 module-boundary rule).
 */
@Module({
  imports: [
    PatientsModule,
    AppointmentsModule,
    ConsultationsModule,
    PrescriptionsModule,
    BillingModule,
    DocumentsModule,
    AuditModule,
  ],
  controllers: [PatientTimelineController],
  providers: [PatientTimelineService],
})
export class PatientTimelineModule {}
