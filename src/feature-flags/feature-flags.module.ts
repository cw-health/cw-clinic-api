import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FeatureFlagsAdminController } from './feature-flags-admin.controller';
import { FeatureFlagsService } from './feature-flags.service';

@Module({
  imports: [AuditModule],
  controllers: [FeatureFlagsAdminController],
  providers: [FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsModule {}
