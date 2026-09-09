import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import { ClinicsModule } from '../clinics/clinics.module';
import { ConsultationsModule } from '../consultations/consultations.module';
import { DoctorsModule } from '../doctors/doctors.module';
import { MedicinesModule } from '../medicines/medicines.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PatientsModule } from '../patients/patients.module';
import { PrescriptionsController } from './prescriptions.controller';
import { PrescriptionsService } from './prescriptions.service';

@Module({
  imports: [
    JwtModule.register({}),
    ClinicsModule,
    ConsultationsModule,
    DoctorsModule,
    PatientsModule,
    MedicinesModule,
    NotificationsModule,
    AuditModule,
  ],
  controllers: [PrescriptionsController],
  providers: [PrescriptionsService],
  exports: [PrescriptionsService],
})
export class PrescriptionsModule {}
