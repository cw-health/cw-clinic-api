import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
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
import { DoctorsService } from '../doctors/doctors.service';
import { ConsultationsService, type DoctorOwnershipScope } from './consultations.service';
import { AmendConsultationDto } from './dto/amend-consultation.dto';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { QueryConsultationsDto } from './dto/query-consultations.dto';
import { UpdateConsultationDto } from './dto/update-consultation.dto';

@ApiTags('consultations')
@ApiBearerAuth()
@Controller({ path: 'consultations', version: '1' })
export class ConsultationsController {
  constructor(
    private readonly consultationsService: ConsultationsService,
    private readonly doctorsService: DoctorsService,
  ) {}

  @Post()
  @RequirePermissions('consultations:create')
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateConsultationDto,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    return this.consultationsService.create(clinicId, user.sub, dto, scope, auditCtx);
  }

  @Get()
  @RequirePermissions('consultations:read')
  async findAll(@Tenant() tenant: TenantContext, @Query() query: QueryConsultationsDto) {
    return this.consultationsService.findAll(requireClinicId(tenant), query);
  }

  @Get(':id')
  @RequirePermissions('consultations:read')
  async findById(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.consultationsService.findByIdAudited(
      requireClinicId(tenant),
      id,
      user.sub,
      auditCtx,
    );
  }

  @Patch(':id')
  @RequirePermissions('consultations:update')
  async update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateConsultationDto,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    return this.consultationsService.update(clinicId, id, dto, user.sub, scope, auditCtx);
  }

  @Post(':id/complete')
  @RequirePermissions('consultations:update')
  async complete(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    return this.consultationsService.complete(clinicId, id, user.sub, scope, auditCtx);
  }

  @Post(':id/amend')
  @RequirePermissions('consultations:amend')
  async amend(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AmendConsultationDto,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    return this.consultationsService.amend(clinicId, id, dto, user.sub, scope, auditCtx);
  }

  @Get(':id/amendments')
  @RequirePermissions('consultations:read')
  async findAmendments(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    return this.consultationsService.findAmendments(clinicId, id, scope);
  }

  /** A caller with a Doctor profile in this clinic is always scoped to their own consultations (docs/RBAC.md §3). */
  private async resolveOwnDoctorScope(
    clinicId: string,
    user: JwtPayload,
  ): Promise<DoctorOwnershipScope | undefined> {
    const ownDoctor = await this.doctorsService.findOwn(clinicId, user.sub).catch(() => null);
    return ownDoctor ? { doctorId: ownDoctor.id } : undefined;
  }
}
