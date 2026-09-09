import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import type { AppConfig } from '../config/configuration';
import { PatientsModule } from '../patients/patients.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { LocalDiskStorageProvider } from './storage-providers/local-disk-storage-provider';
import { S3StorageProvider } from './storage-providers/s3-storage-provider';
import { DOCUMENT_STORAGE_PROVIDER } from './storage-providers/document-storage-provider.interface';

@Module({
  imports: [
    // JwtModule.register({}) mirrors BillingModule/PrescriptionsModule: signs/
    // verifies the download-token payload with an explicit secret at call
    // time, not the module-wide default.
    JwtModule.register({}),
    PatientsModule,
    AuditModule,
  ],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    LocalDiskStorageProvider,
    S3StorageProvider,
    {
      provide: DOCUMENT_STORAGE_PROVIDER,
      inject: [ConfigService, LocalDiskStorageProvider, S3StorageProvider],
      useFactory: (
        configService: ConfigService<AppConfig, true>,
        local: LocalDiskStorageProvider,
        s3: S3StorageProvider,
      ) => (configService.get('storageDriver', { infer: true }) === 's3' ? s3 : local),
    },
  ],
  // DOCUMENT_STORAGE_PROVIDER exported so other modules (e.g. clinics, for
  // clinic-registry documents) reuse the same physical storage layer
  // instead of registering a second one — see ClinicDocument's own doc
  // comment (prisma/schema.prisma).
  exports: [DocumentsService, DOCUMENT_STORAGE_PROVIDER],
})
export class DocumentsModule {}
