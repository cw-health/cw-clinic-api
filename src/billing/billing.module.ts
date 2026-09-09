import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import { ClinicsModule } from '../clinics/clinics.module';
import { ConsultationsModule } from '../consultations/consultations.module';
import { DoctorsModule } from '../doctors/doctors.module';
import { PatientsModule } from '../patients/patients.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { ManualPaymentProvider } from './payment-providers/manual-payment-provider';
import { PAYMENT_PROVIDER } from './payment-providers/payment-provider.interface';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [
    // JwtModule.register({}) mirrors PrescriptionsModule: signs/verifies the
    // download-token payload with an explicit secret at call time, not the
    // module-wide default.
    JwtModule.register({}),
    ClinicsModule,
    ConsultationsModule,
    DoctorsModule,
    PatientsModule,
    AuditModule,
  ],
  controllers: [InvoicesController, PaymentsController],
  providers: [
    InvoicesService,
    PaymentsService,
    { provide: PAYMENT_PROVIDER, useClass: ManualPaymentProvider },
  ],
  // Exported for patient-timeline's aggregator module (Patient Master
  // upgrade) to read invoices/payments for one patient — same pattern as
  // every other module here exporting its service for reuse.
  exports: [InvoicesService, PaymentsService],
})
export class BillingModule {}
