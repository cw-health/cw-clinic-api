import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
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
import type { DoctorOwnershipScope } from '../consultations/consultations.service';
import { CreateDiagnosisDto } from './dto/create-diagnosis.dto';
import { DiagnosesService } from './diagnoses.service';

/** Nested under /consultations/:consultationId/diagnoses — a Diagnosis has no meaning outside its parent Consultation. */
@ApiTags('diagnoses')
@ApiBearerAuth()
@Controller({ path: 'consultations/:consultationId/diagnoses', version: '1' })
export class DiagnosesController {
  constructor(
    private readonly diagnosesService: DiagnosesService,
    private readonly doctorsService: DoctorsService,
  ) {}

  @Post()
  @RequirePermissions('diagnoses:create')
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('consultationId') consultationId: string,
    @Body() dto: CreateDiagnosisDto,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    return this.diagnosesService.create(clinicId, consultationId, user.sub, dto, scope, auditCtx);
  }

  @Get()
  @RequirePermissions('diagnoses:read')
  async findAll(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('consultationId') consultationId: string,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    return this.diagnosesService.findAll(clinicId, consultationId, scope);
  }

  @Delete(':id')
  @RequirePermissions('diagnoses:delete')
  async remove(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('consultationId') consultationId: string,
    @Param('id') id: string,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    await this.diagnosesService.remove(clinicId, consultationId, id, user.sub, scope, auditCtx);
    return { success: true };
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
