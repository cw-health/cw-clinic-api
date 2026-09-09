import { Module } from '@nestjs/common';
import { ClinicsModule } from '../clinics/clinics.module';
import { DoctorsModule } from '../doctors/doctors.module';
import { PatientsModule } from '../patients/patients.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { UsageAdminController } from './usage-admin.controller';
import { UsageService } from './usage.service';

@Module({
  imports: [ClinicsModule, DoctorsModule, PatientsModule, SubscriptionsModule],
  controllers: [UsageAdminController],
  providers: [UsageService],
})
export class UsageModule {}
