import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Tenant } from '../auth/decorators/tenant.decorator';
import type { TenantContext } from '../auth/guards/tenant.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  AuditContext,
  type AuditRequestContext,
} from '../common/decorators/audit-context.decorator';
import { requireClinicId } from '../common/require-clinic-id.util';
import { CheckPatientDuplicatesDto } from './dto/check-duplicates.dto';
import { CreatePatientDto } from './dto/create-patient.dto';
import { QueryPatientsDto } from './dto/query-patients.dto';
import { UpdateOwnPatientDto, UpdatePatientDto } from './dto/update-patient.dto';
import { PatientsService } from './patients.service';

@ApiTags('patients')
@ApiBearerAuth()
@Controller({ path: 'patients', version: '1' })
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post()
  @RequirePermissions('patients:create')
  async create(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreatePatientDto,
    @CurrentUser() user: JwtPayload,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.patientsService.create(requireClinicId(tenant), dto, user.sub, auditCtx);
  }

  @Get()
  @RequirePermissions('patients:read')
  async findAll(@Tenant() tenant: TenantContext, @Query() query: QueryPatientsDto) {
    return this.patientsService.findAll(requireClinicId(tenant), query);
  }

  // Declared ahead of the ':id' routes below for the same reason as 'me'.
  @Post('check-duplicates')
  @RequirePermissions('patients:create')
  async checkDuplicates(@Tenant() tenant: TenantContext, @Body() dto: CheckPatientDuplicatesDto) {
    return this.patientsService.checkDuplicates(requireClinicId(tenant), dto);
  }

  // Declared ahead of the ':id' routes below so Nest doesn't match "me" as an :id param.
  @Get('me')
  @RequirePermissions('patients:read-own')
  async findOwn(@Tenant() tenant: TenantContext, @CurrentUser() user: JwtPayload) {
    return this.patientsService.findOwn(requireClinicId(tenant), user.sub);
  }

  @Patch('me')
  @RequirePermissions('patients:update-own')
  async updateOwn(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateOwnPatientDto,
  ) {
    return this.patientsService.updateOwn(requireClinicId(tenant), user.sub, dto);
  }

  @Get(':id')
  @RequirePermissions('patients:read')
  async findById(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.patientsService.findByIdAudited(requireClinicId(tenant), id, user.sub, auditCtx);
  }

  @Patch(':id')
  @RequirePermissions('patients:update')
  async update(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdatePatientDto,
    @CurrentUser() user: JwtPayload,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.patientsService.update(requireClinicId(tenant), id, dto, user.sub, auditCtx);
  }

  @Post(':id/activate')
  @RequirePermissions('patients:update')
  async activate(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.patientsService.activate(requireClinicId(tenant), id, user.sub, auditCtx);
  }

  @Post(':id/deactivate')
  @RequirePermissions('patients:update')
  async deactivate(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.patientsService.deactivate(requireClinicId(tenant), id, user.sub, auditCtx);
  }

  @Post(':id/archive')
  @RequirePermissions('patients:archive')
  async archive(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.patientsService.archive(requireClinicId(tenant), id, user.sub, auditCtx);
  }

  @Post(':id/restore')
  @RequirePermissions('patients:archive')
  async restore(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.patientsService.restore(requireClinicId(tenant), id, user.sub, auditCtx);
  }
}
