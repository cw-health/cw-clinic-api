import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { RequireAnyPermission } from '../auth/decorators/require-any-permission.decorator';
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
import { PatientsService } from '../patients/patients.service';
import { CreatePrescriptionItemDto } from './dto/create-prescription-item.dto';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { QueryPrescriptionsDto } from './dto/query-prescriptions.dto';
import { UpdatePrescriptionItemDto } from './dto/update-prescription-item.dto';
import { UpdatePrescriptionDto } from './dto/update-prescription.dto';
import { PrescriptionsService, type PrescriptionOwnershipScope } from './prescriptions.service';

@ApiTags('prescriptions')
@ApiBearerAuth()
@Controller({ path: 'prescriptions', version: '1' })
export class PrescriptionsController {
  constructor(
    private readonly prescriptionsService: PrescriptionsService,
    private readonly doctorsService: DoctorsService,
    private readonly patientsService: PatientsService,
  ) {}

  @Post()
  @RequirePermissions('prescriptions:create')
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePrescriptionDto,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    return this.prescriptionsService.create(clinicId, user.sub, dto, scope, auditCtx);
  }

  @Get()
  @RequirePermissions('prescriptions:read')
  async findAll(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryPrescriptionsDto,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    return this.prescriptionsService.findAll(clinicId, query, scope);
  }

  // Declared ahead of the ':id' routes below so Nest doesn't match "me" as an :id param.
  @Get('me')
  @RequirePermissions('prescriptions:read-own')
  async findOwn(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryPrescriptionsDto,
  ) {
    const clinicId = requireClinicId(tenant);
    const ownPatient = await this.patientsService.findOwn(clinicId, user.sub);
    return this.prescriptionsService.findOwnForPatient(clinicId, ownPatient.id, query);
  }

  @Get(':id')
  @RequireAnyPermission('prescriptions:read', 'prescriptions:read-own')
  async findById(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveReadScope(clinicId, user);
    return this.prescriptionsService.findByIdAudited(clinicId, id, user.sub, scope, auditCtx);
  }

  @Patch(':id')
  @RequirePermissions('prescriptions:update')
  async update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePrescriptionDto,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    return this.prescriptionsService.update(clinicId, id, dto, user.sub, scope, auditCtx);
  }

  @Post(':id/items')
  @RequirePermissions('prescriptions:update')
  async addItem(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreatePrescriptionItemDto,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    return this.prescriptionsService.addItem(clinicId, id, dto, scope);
  }

  @Patch(':id/items/:itemId')
  @RequirePermissions('prescriptions:update')
  async updateItem(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdatePrescriptionItemDto,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    return this.prescriptionsService.updateItem(clinicId, id, itemId, dto, scope);
  }

  @Delete(':id/items/:itemId')
  @RequirePermissions('prescriptions:update')
  async removeItem(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    return this.prescriptionsService.removeItem(clinicId, id, itemId, scope);
  }

  @Post(':id/finalize')
  @RequirePermissions('prescriptions:update')
  async finalize(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    return this.prescriptionsService.finalize(clinicId, id, user.sub, scope, auditCtx);
  }

  @Post(':id/amend')
  @RequirePermissions('prescriptions:update')
  async amend(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    return this.prescriptionsService.amend(clinicId, id, user.sub, scope, auditCtx);
  }

  /** Mints a short-lived token for the public PDF route below — see prescription-download-token.interface.ts. */
  @Post(':id/download-token')
  @RequireAnyPermission('prescriptions:read', 'prescriptions:read-own')
  async issueDownloadToken(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveReadScope(clinicId, user);
    return this.prescriptionsService.issueDownloadToken(clinicId, id, scope);
  }

  /**
   * Public: authorization for this route is the signed, single-purpose,
   * short-lived token itself (minted only after the normal permission +
   * ownership check above), not the request's bearer token — a browser/
   * mobile "view PDF" tap can't attach an Authorization header to a plain
   * link, so this is the secure download mechanism (task brief) in place
   * of a client-side auth header.
   */
  @Public()
  @Get(':id/pdf')
  @Header('Content-Type', 'application/pdf')
  async downloadPdf(
    @Param('id') id: string,
    @Query('token') token: string,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.prescriptionsService.generatePdfFromToken(id, token);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `inline; filename="${filename}"`,
    });
  }

  /** A caller with a Doctor profile in this clinic is always scoped to their own prescriptions (docs/RBAC.md §3). */
  private async resolveOwnDoctorScope(
    clinicId: string,
    user: JwtPayload,
  ): Promise<PrescriptionOwnershipScope | undefined> {
    const ownDoctor = await this.doctorsService.findOwn(clinicId, user.sub).catch(() => null);
    return ownDoctor ? { doctorId: ownDoctor.id } : undefined;
  }

  /** Shared by GET /:id and the download-token route, reachable by either staff (prescriptions:read) or a patient (prescriptions:read-own). */
  private async resolveReadScope(
    clinicId: string,
    user: JwtPayload,
  ): Promise<PrescriptionOwnershipScope | undefined> {
    if (user.permissions.includes('prescriptions:read')) {
      return this.resolveOwnDoctorScope(clinicId, user);
    }
    const own = await this.patientsService.findOwn(clinicId, user.sub);
    return { patientId: own.id };
  }
}
