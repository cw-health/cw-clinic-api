import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ConsultationsModule } from '../consultations/consultations.module';
import { DoctorsModule } from '../doctors/doctors.module';
import { DiagnosesController } from './diagnoses.controller';
import { DiagnosesService } from './diagnoses.service';

@Module({
  imports: [ConsultationsModule, DoctorsModule, AuditModule],
  controllers: [DiagnosesController],
  providers: [DiagnosesService],
  exports: [DiagnosesService],
})
export class DiagnosesModule {}
