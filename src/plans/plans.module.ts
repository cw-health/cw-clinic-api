import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PlansAdminController } from './plans-admin.controller';
import { PlansService } from './plans.service';

@Module({
  imports: [AuditModule],
  controllers: [PlansAdminController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
