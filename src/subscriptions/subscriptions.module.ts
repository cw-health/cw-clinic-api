import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ClinicsModule } from '../clinics/clinics.module';
import { PlansModule } from '../plans/plans.module';
import { SubscriptionsAdminController } from './subscriptions-admin.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [AuditModule, ClinicsModule, PlansModule],
  controllers: [SubscriptionsAdminController],
  providers: [SubscriptionsService],
  // Exported for UsageModule (SA-09): usage-vs-limit reporting needs each
  // clinic's current plan limits, reusing SubscriptionsService rather than
  // a second Subscription-reading path (module-boundary rule, CLAUDE.md #11).
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
