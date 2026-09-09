import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import configuration, { AppConfig } from './config/configuration';
import { validateEnvironment } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { ClinicsModule } from './clinics/clinics.module';
import { BranchesModule } from './branches/branches.module';
import { DepartmentsModule } from './departments/departments.module';
import { DoctorsModule } from './doctors/doctors.module';
import { PatientsModule } from './patients/patients.module';
import { SpecializationsModule } from './specializations/specializations.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { QueueModule } from './queue/queue.module';
import { ConsultationsModule } from './consultations/consultations.module';
import { DiagnosesModule } from './diagnoses/diagnoses.module';
import { InvestigationsModule } from './investigations/investigations.module';
import { MedicinesModule } from './medicines/medicines.module';
import { PrescriptionsModule } from './prescriptions/prescriptions.module';
import { PharmacyModule } from './pharmacy/pharmacy.module';
import { AuditModule } from './audit/audit.module';
import { BillingModule } from './billing/billing.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DocumentsModule } from './documents/documents.module';
import { RemindersModule } from './reminders/reminders.module';
import { PlatformUsersModule } from './platform-users/platform-users.module';
import { PlansModule } from './plans/plans.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { FeatureFlagsModule } from './feature-flags/feature-flags.module';
import { UsageModule } from './usage/usage.module';
import { StaffModule } from './staff/staff.module';
import { RolesModule } from './roles/roles.module';
import { PatientTimelineModule } from './patient-timeline/patient-timeline.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnvironment,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const nodeEnv = configService.get('nodeEnv', { infer: true });
        return {
          pinoHttp: {
            level: configService.get('logLevel', { infer: true }),
            genReqId: (req: { headers: Record<string, unknown> }) =>
              (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
            customProps: (req: { headers: Record<string, unknown> }) => ({
              requestId: req.headers['x-request-id'],
            }),
            // Never log request/response bodies — docs/SECURITY.md §8 forbids
            // logging patient PII/PHI or full request/response bodies.
            serializers: {
              req: (req: Record<string, unknown>) => ({
                id: req.id,
                method: req.method,
                url: req.url,
              }),
              res: (res: Record<string, unknown>) => ({
                statusCode: res.statusCode,
              }),
            },
            transport: nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
          },
        };
      },
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => [
        {
          ttl: configService.get('throttle', { infer: true }).ttlMs,
          limit: configService.get('throttle', { infer: true }).limit,
        },
      ],
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    ClinicsModule,
    BranchesModule,
    DepartmentsModule,
    DoctorsModule,
    StaffModule,
    RolesModule,
    PatientsModule,
    SpecializationsModule,
    AppointmentsModule,
    QueueModule,
    ConsultationsModule,
    DiagnosesModule,
    InvestigationsModule,
    MedicinesModule,
    PrescriptionsModule,
    PharmacyModule,
    AuditModule,
    BillingModule,
    NotificationsModule,
    DocumentsModule,
    RemindersModule,
    PlatformUsersModule,
    PlansModule,
    SubscriptionsModule,
    FeatureFlagsModule,
    UsageModule,
    PatientTimelineModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
