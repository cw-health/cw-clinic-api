import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PlatformUsersAdminController } from './platform-users-admin.controller';
import { PlatformUsersService } from './platform-users.service';

@Module({
  imports: [AuditModule],
  controllers: [PlatformUsersAdminController],
  providers: [PlatformUsersService],
})
export class PlatformUsersModule {}
