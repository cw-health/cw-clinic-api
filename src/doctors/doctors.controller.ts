import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Tenant } from '../auth/decorators/tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/guards/tenant.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  AuditContext,
  type AuditRequestContext,
} from '../common/decorators/audit-context.decorator';
import { requireClinicId } from '../common/require-clinic-id.util';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { CreateUnavailabilityDto } from './dto/create-unavailability.dto';
import { QueryDoctorsDto } from './dto/query-doctors.dto';
import { SetAvailabilityDto } from './dto/set-availability.dto';
import { SetBreaksDto } from './dto/set-breaks.dto';
import {
  UpdateDoctorDto,
  UpdateDoctorStatusDto,
  UpdateOwnDoctorDto,
} from './dto/update-doctor.dto';
import { DoctorsService } from './doctors.service';

@ApiTags('doctors')
@ApiBearerAuth()
@Controller({ path: 'doctors', version: '1' })
export class DoctorsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  @Post()
  @RequirePermissions('doctors:create')
  async create(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateDoctorDto,
    @CurrentUser() user: JwtPayload,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.doctorsService.create(requireClinicId(tenant), dto, user.sub, auditCtx);
  }

  @Get()
  @RequirePermissions('doctors:read')
  async findAll(@Tenant() tenant: TenantContext, @Query() query: QueryDoctorsDto) {
    return this.doctorsService.findAll(requireClinicId(tenant), query);
  }

  // Declared ahead of the ':id' routes below so Nest doesn't match "me" as an :id param.
  @Get('me')
  @RequirePermissions('doctors:read-own')
  async findOwn(@Tenant() tenant: TenantContext, @CurrentUser() user: JwtPayload) {
    return this.doctorsService.findOwn(requireClinicId(tenant), user.sub);
  }

  @Patch('me')
  @RequirePermissions('doctors:update-own')
  async updateOwn(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateOwnDoctorDto,
  ) {
    return this.doctorsService.updateOwn(requireClinicId(tenant), user.sub, dto);
  }

  @Get('me/availability')
  @RequirePermissions('doctors:read-own')
  async getOwnAvailability(@Tenant() tenant: TenantContext, @CurrentUser() user: JwtPayload) {
    const clinicId = requireClinicId(tenant);
    const own = await this.doctorsService.findOwn(clinicId, user.sub);
    return this.doctorsService.getAvailability(clinicId, own.id);
  }

  @Put('me/availability')
  @RequirePermissions('doctors:update-own')
  async setOwnAvailability(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetAvailabilityDto,
  ) {
    const clinicId = requireClinicId(tenant);
    const own = await this.doctorsService.findOwn(clinicId, user.sub);
    return this.doctorsService.setAvailability(clinicId, own.id, dto);
  }

  @Get('me/breaks')
  @RequirePermissions('doctors:read-own')
  async getOwnBreaks(@Tenant() tenant: TenantContext, @CurrentUser() user: JwtPayload) {
    const clinicId = requireClinicId(tenant);
    const own = await this.doctorsService.findOwn(clinicId, user.sub);
    return this.doctorsService.getBreaks(clinicId, own.id);
  }

  @Put('me/breaks')
  @RequirePermissions('doctors:update-own')
  async setOwnBreaks(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetBreaksDto,
  ) {
    const clinicId = requireClinicId(tenant);
    const own = await this.doctorsService.findOwn(clinicId, user.sub);
    return this.doctorsService.setBreaks(clinicId, own.id, dto);
  }

  @Get('me/unavailability')
  @RequirePermissions('doctors:read-own')
  async listOwnUnavailability(@Tenant() tenant: TenantContext, @CurrentUser() user: JwtPayload) {
    const clinicId = requireClinicId(tenant);
    const own = await this.doctorsService.findOwn(clinicId, user.sub);
    return this.doctorsService.listUnavailability(clinicId, own.id);
  }

  @Post('me/unavailability')
  @RequirePermissions('doctors:update-own')
  async addOwnUnavailability(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateUnavailabilityDto,
  ) {
    const clinicId = requireClinicId(tenant);
    const own = await this.doctorsService.findOwn(clinicId, user.sub);
    return this.doctorsService.addUnavailability(clinicId, own.id, dto);
  }

  @Delete('me/unavailability/:unavailabilityId')
  @RequirePermissions('doctors:update-own')
  async removeOwnUnavailability(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('unavailabilityId') unavailabilityId: string,
  ) {
    const clinicId = requireClinicId(tenant);
    const own = await this.doctorsService.findOwn(clinicId, user.sub);
    await this.doctorsService.removeUnavailability(clinicId, own.id, unavailabilityId);
  }

  @Get(':id')
  @RequirePermissions('doctors:read')
  async findById(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.doctorsService.findByIdAudited(requireClinicId(tenant), id, user.sub, auditCtx);
  }

  @Patch(':id')
  @RequirePermissions('doctors:update')
  async update(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateDoctorDto,
    @CurrentUser() user: JwtPayload,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.doctorsService.update(requireClinicId(tenant), id, dto, user.sub, auditCtx);
  }

  @Patch(':id/status')
  @RequirePermissions('doctors:update')
  async updateStatus(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateDoctorStatusDto,
    @CurrentUser() user: JwtPayload,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.doctorsService.updateStatus(
      requireClinicId(tenant),
      id,
      dto.status,
      user.sub,
      auditCtx,
    );
  }

  @Get(':id/availability')
  @RequirePermissions('doctors:read')
  async getAvailability(@Tenant() tenant: TenantContext, @Param('id') id: string) {
    return this.doctorsService.getAvailability(requireClinicId(tenant), id);
  }

  @Put(':id/availability')
  @RequirePermissions('doctors:update')
  async setAvailability(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: SetAvailabilityDto,
  ) {
    return this.doctorsService.setAvailability(requireClinicId(tenant), id, dto);
  }

  @Get(':id/breaks')
  @RequirePermissions('doctors:read')
  async getBreaks(@Tenant() tenant: TenantContext, @Param('id') id: string) {
    return this.doctorsService.getBreaks(requireClinicId(tenant), id);
  }

  @Put(':id/breaks')
  @RequirePermissions('doctors:update')
  async setBreaks(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: SetBreaksDto,
  ) {
    return this.doctorsService.setBreaks(requireClinicId(tenant), id, dto);
  }

  @Get(':id/unavailability')
  @RequirePermissions('doctors:read')
  async listUnavailability(@Tenant() tenant: TenantContext, @Param('id') id: string) {
    return this.doctorsService.listUnavailability(requireClinicId(tenant), id);
  }

  @Post(':id/unavailability')
  @RequirePermissions('doctors:update')
  async addUnavailability(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: CreateUnavailabilityDto,
  ) {
    return this.doctorsService.addUnavailability(requireClinicId(tenant), id, dto);
  }

  @Delete(':id/unavailability/:unavailabilityId')
  @RequirePermissions('doctors:update')
  async removeUnavailability(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Param('unavailabilityId') unavailabilityId: string,
  ) {
    await this.doctorsService.removeUnavailability(requireClinicId(tenant), id, unavailabilityId);
  }
}
