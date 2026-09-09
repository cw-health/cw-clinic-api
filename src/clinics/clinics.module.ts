import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { ClinicsAdminController } from './clinics-admin.controller';
import { ClinicsController } from './clinics.controller';
import { ClinicsService } from './clinics.service';

@Module({
  // DocumentsModule imported for its exported DOCUMENT_STORAGE_PROVIDER
  // token — clinic-registration documents (SA-03.1) reuse the same
  // physical storage layer as patient documents rather than a second one
  // (see ClinicDocument's doc comment, prisma/schema.prisma).
  imports: [AuditModule, DocumentsModule],
  controllers: [ClinicsController, ClinicsAdminController],
  providers: [ClinicsService],
  // Exported for AppointmentsModule (Phase 5): slot calculation needs the
  // clinic's own working hours/holidays/timezone/default duration — module
  // boundaries rule (CLAUDE.md #11) says import the service, never reach
  // into ClinicsService's Prisma models directly.
  exports: [ClinicsService],
})
export class ClinicsModule {}
