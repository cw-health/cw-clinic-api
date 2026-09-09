import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateFeatureFlagDto } from './dto/create-feature-flag.dto';
import { QueryFeatureFlagsDto } from './dto/query-feature-flags.dto';
import { UpdateFeatureFlagDto } from './dto/update-feature-flag.dto';
import { UpsertFeatureFlagOverrideDto } from './dto/upsert-feature-flag-override.dto';
import { FeatureFlagsService } from './feature-flags.service';

/**
 * Super Admin platform feature-flag management (SA-08,
 * docs/SUPER_ADMIN_ARCHITECTURE.md §6.7) — mirrors PlansAdminController's
 * shape: `super-admin:feature-flags-read` for read access,
 * `super-admin:feature-flags-manage` for every mutation (both permission
 * keys were already seeded in SA-01, no new permission keys added here).
 * Clinic-override routes are addressed by `:clinicId` so `TenantGuard`'s
 * route-param check applies the same way it does on
 * SubscriptionsAdminController's clinic-nested routes.
 */
@ApiTags('super-admin-feature-flags')
@ApiBearerAuth()
@Controller({ path: 'super-admin/feature-flags', version: '1' })
export class FeatureFlagsAdminController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  @Get()
  @RequirePermissions('super-admin:feature-flags-read')
  async list(@Query() query: QueryFeatureFlagsDto) {
    return this.featureFlagsService.listFlags(query);
  }

  @Get(':id')
  @RequirePermissions('super-admin:feature-flags-read')
  async findOne(@Param('id') id: string) {
    return this.featureFlagsService.getFlagById(id);
  }

  @Post()
  @RequirePermissions('super-admin:feature-flags-manage')
  async create(@Body() dto: CreateFeatureFlagDto, @CurrentUser() user: JwtPayload) {
    return this.featureFlagsService.createFlag(dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('super-admin:feature-flags-manage')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateFeatureFlagDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.featureFlagsService.updateFlag(id, dto, user.sub);
  }

  @Post(':id/enable')
  @RequirePermissions('super-admin:feature-flags-manage')
  async enable(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.featureFlagsService.enableFlag(id, user.sub);
  }

  @Post(':id/disable')
  @RequirePermissions('super-admin:feature-flags-manage')
  async disable(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.featureFlagsService.disableFlag(id, user.sub);
  }

  @Put(':id/overrides/:clinicId')
  @RequirePermissions('super-admin:feature-flags-manage')
  async setOverride(
    @Param('id') id: string,
    @Param('clinicId') clinicId: string,
    @Body() dto: UpsertFeatureFlagOverrideDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.featureFlagsService.setClinicOverride(id, clinicId, dto, user.sub);
  }

  @Delete(':id/overrides/:clinicId')
  @RequirePermissions('super-admin:feature-flags-manage')
  async removeOverride(
    @Param('id') id: string,
    @Param('clinicId') clinicId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.featureFlagsService.removeClinicOverride(id, clinicId, user.sub);
  }
}
