import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { QueryUsageDto } from './dto/query-usage.dto';
import { UsageService } from './usage.service';

/**
 * Super Admin Clinic Usage & Limits (SA-09,
 * docs/SUPER_ADMIN_ARCHITECTURE.md §6.15/§9) — read-only reporting over
 * data other modules own (Doctor/Patient/ClinicMembership counts, Plan
 * limits via Subscription). Single permission key for both routes: this is
 * a report, not a mutation surface.
 */
@ApiTags('super-admin-usage')
@ApiBearerAuth()
@Controller({ path: 'super-admin/usage', version: '1' })
export class UsageAdminController {
  constructor(private readonly usageService: UsageService) {}

  @Get()
  @RequirePermissions('super-admin:usage-read')
  async getOverview(@Query() query: QueryUsageDto) {
    return this.usageService.getOverview(query);
  }

  @Get(':clinicId')
  @RequirePermissions('super-admin:usage-read')
  async getClinicUsage(@Param('clinicId') clinicId: string) {
    return this.usageService.getClinicUsage(clinicId);
  }
}
