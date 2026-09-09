import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Tenant } from '../auth/decorators/tenant.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { TenantContext } from '../auth/guards/tenant.guard';
import { requireClinicId } from '../common/require-clinic-id.util';
import { ClinicsService } from './clinics.service';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { OnboardingAddressDto } from './dto/onboarding-address.dto';
import { OnboardingBasicInfoDto } from './dto/onboarding-basic-info.dto';
import { OnboardingLegalInfoDto } from './dto/onboarding-legal-info.dto';
import { SetWorkingHoursDto } from './dto/set-working-hours.dto';
import { UpdateClinicDto } from './dto/update-clinic.dto';

/**
 * All routes act on the caller's own clinic ("me") — there is no
 * `:clinicId` path param, so clinicId can never be taken from client input
 * (docs/SECURITY.md §4); it always comes from TenantGuard's resolved
 * tenant context.
 */
@ApiTags('clinics')
@ApiBearerAuth()
@Controller({ path: 'clinics', version: '1' })
export class ClinicsController {
  constructor(private readonly clinicsService: ClinicsService) {}

  @Get('me')
  @RequirePermissions('clinic-settings:read')
  async getOwnClinic(@Tenant() tenant: TenantContext) {
    return this.clinicsService.getOwnClinic(requireClinicId(tenant));
  }

  @Patch('me')
  @RequirePermissions('clinic-settings:update')
  async updateOwnClinic(
    @Tenant() tenant: TenantContext,
    @Body() dto: UpdateClinicDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.clinicsService.updateOwnClinic(requireClinicId(tenant), dto, user.sub);
  }

  @Get('me/working-hours')
  @RequirePermissions('clinic-settings:read')
  async getWorkingHours(@Tenant() tenant: TenantContext) {
    return this.clinicsService.getWorkingHours(requireClinicId(tenant));
  }

  @Put('me/working-hours')
  @RequirePermissions('clinic-settings:update')
  async setWorkingHours(
    @Tenant() tenant: TenantContext,
    @Body() dto: SetWorkingHoursDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.clinicsService.setWorkingHours(requireClinicId(tenant), dto, user.sub);
  }

  @Get('me/holidays')
  @RequirePermissions('clinic-settings:read')
  async listHolidays(@Tenant() tenant: TenantContext) {
    return this.clinicsService.listHolidays(requireClinicId(tenant));
  }

  @Post('me/holidays')
  @RequirePermissions('clinic-settings:update')
  async addHoliday(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateHolidayDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.clinicsService.addHoliday(requireClinicId(tenant), dto, user.sub);
  }

  @Delete('me/holidays/:id')
  @RequirePermissions('clinic-settings:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeHoliday(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.clinicsService.removeHoliday(requireClinicId(tenant), id, user.sub);
  }

  // ---- Tenant self-service onboarding wizard (Phase 1A) ----
  //
  // Steps 4 (working hours) and 6 (review)/7 (this endpoint itself) are
  // covered by the existing endpoints above and the status read below —
  // only the genuinely new steps (basic info, legal info, address, primary
  // administrator, and the explicit "complete" action) get dedicated
  // routes here. clinicId and actorUserId both come from the authenticated
  // session (TenantGuard/JwtPayload), never from the request body.

  @Get('me/onboarding')
  @RequirePermissions('clinic-settings:read')
  async getOnboardingStatus(@Tenant() tenant: TenantContext) {
    return this.clinicsService.getOnboardingStatus(requireClinicId(tenant));
  }

  @Patch('me/onboarding/basic-info')
  @RequirePermissions('clinic-settings:update')
  async updateOnboardingBasicInfo(
    @Tenant() tenant: TenantContext,
    @Body() dto: OnboardingBasicInfoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.clinicsService.updateOnboardingBasicInfo(requireClinicId(tenant), dto, user.sub);
  }

  @Patch('me/onboarding/legal-info')
  @RequirePermissions('clinic-settings:update')
  async updateOnboardingLegalInfo(
    @Tenant() tenant: TenantContext,
    @Body() dto: OnboardingLegalInfoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.clinicsService.updateOnboardingLegalInfo(requireClinicId(tenant), dto, user.sub);
  }

  @Patch('me/onboarding/address')
  @RequirePermissions('clinic-settings:update')
  async updateOnboardingAddress(
    @Tenant() tenant: TenantContext,
    @Body() dto: OnboardingAddressDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.clinicsService.updateOnboardingAddress(requireClinicId(tenant), dto, user.sub);
  }

  @Post('me/onboarding/primary-admin')
  @RequirePermissions('clinic-settings:update')
  async assignSelfAsPrimaryAdmin(@Tenant() tenant: TenantContext, @CurrentUser() user: JwtPayload) {
    return this.clinicsService.assignSelfAsPrimaryAdmin(requireClinicId(tenant), user.sub);
  }

  @Post('me/onboarding/complete')
  @RequirePermissions('clinic-settings:update')
  async completeOnboarding(@Tenant() tenant: TenantContext, @CurrentUser() user: JwtPayload) {
    return this.clinicsService.completeOnboarding(requireClinicId(tenant), user.sub);
  }
}
