import { Module } from '@nestjs/common';
import { AuditLogsAdminController } from './audit-logs-admin.controller';
import { AuditService } from './audit.service';

@Module({
  controllers: [AuditLogsAdminController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
