import { Body, Controller, Get, Param, Post } from '@nestjs/common';
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
import { CreateInvestigationOrderDto } from './dto/create-investigation-order.dto';
import { InvestigationsService } from './investigations.service';

/** Nested under /consultations/:consultationId/investigation-orders for create/list; standalone /investigation-orders/:id for single-record read/cancel. */
@ApiTags('investigations')
@ApiBearerAuth()
@Controller({ version: '1' })
export class InvestigationsController {
  constructor(
    private readonly investigationsService: InvestigationsService,
    private readonly doctorsService: DoctorsService,
  ) {}

  @Post('consultations/:consultationId/investigation-orders')
  @RequirePermissions('investigations:create')
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('consultationId') consultationId: string,
    @Body() dto: CreateInvestigationOrderDto,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    return this.investigationsService.create(
      clinicId,
      consultationId,
      user.sub,
      dto,
      scope,
      auditCtx,
    );
  }

  @Get('consultations/:consultationId/investigation-orders')
  @RequirePermissions('investigations:read')
  async findAll(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('consultationId') consultationId: string,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    return this.investigationsService.findAll(clinicId, consultationId, scope);
  }

  @Get('investigation-orders/:id')
  @RequirePermissions('investigations:read')
  async findById(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    return this.investigationsService.findByIdAudited(clinicId, id, user.sub, scope, auditCtx);
  }

  @Post('investigation-orders/:id/cancel')
  @RequirePermissions('investigations:update')
  async cancel(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    return this.investigationsService.cancel(clinicId, id, user.sub, scope, auditCtx);
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
