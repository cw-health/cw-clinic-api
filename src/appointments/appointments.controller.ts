import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { RequireAnyPermission } from '../auth/decorators/require-any-permission.decorator';
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
import { AppointmentsService } from './appointments.service';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { CreateAppointmentDto, CreateOwnAppointmentDto } from './dto/create-appointment.dto';
import { CreateWalkInAppointmentDto } from './dto/create-walk-in-appointment.dto';
import { QueryAppointmentsDto } from './dto/query-appointments.dto';
import { QueryAvailableSlotsDto } from './dto/query-available-slots.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';

@ApiTags('appointments')
@ApiBearerAuth()
@Controller({ path: 'appointments', version: '1' })
export class AppointmentsController {
  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly doctorsService: DoctorsService,
    private readonly patientsService: PatientsService,
  ) {}

  @Post()
  @RequirePermissions('appointments:create')
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateAppointmentDto,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.appointmentsService.create(requireClinicId(tenant), user.sub, dto, auditCtx);
  }

  @Post('me')
  @RequirePermissions('appointments:create-own')
  async createOwn(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateOwnAppointmentDto,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.appointmentsService.createOwn(requireClinicId(tenant), user.sub, dto, auditCtx);
  }

  @Post('walk-in')
  @RequirePermissions('appointments:create')
  async createWalkIn(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateWalkInAppointmentDto,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.appointmentsService.createWalkIn(requireClinicId(tenant), user.sub, dto, auditCtx);
  }

  @Get('available-slots')
  @RequireAnyPermission('appointments:create', 'appointments:create-own')
  async getAvailableSlots(@Tenant() tenant: TenantContext, @Query() query: QueryAvailableSlotsDto) {
    return this.appointmentsService.getAvailableSlots(requireClinicId(tenant), query);
  }

  @Get()
  @RequirePermissions('appointments:read')
  async findAll(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryAppointmentsDto,
  ) {
    const clinicId = requireClinicId(tenant);
    // A caller who has their own Doctor profile in this clinic is always
    // scoped to it for the list view, regardless of the clinic-wide
    // appointments:read grant (docs/RBAC.md §3 — ownership layered on top
    // of permission; mirrors how doctors:read-own layers under doctors:read).
    const ownDoctor = await this.doctorsService.findOwn(clinicId, user.sub).catch(() => null);
    return this.appointmentsService.findAll(
      clinicId,
      query,
      ownDoctor ? { doctorId: ownDoctor.id } : undefined,
    );
  }

  // Declared ahead of the ':id' route below so Nest doesn't match "me" as an :id param.
  @Get('me')
  @RequirePermissions('appointments:read-own')
  async findOwn(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryAppointmentsDto,
  ) {
    return this.appointmentsService.findOwn(requireClinicId(tenant), user.sub, query);
  }

  @Get(':id')
  @RequireAnyPermission('appointments:read', 'appointments:read-own')
  async findById(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveReadScope(clinicId, user);
    return this.appointmentsService.findById(clinicId, id, scope);
  }

  @Patch(':id')
  @RequirePermissions('appointments:update')
  async update(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentDto,
    @CurrentUser() user: JwtPayload,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.appointmentsService.update(requireClinicId(tenant), id, dto, user.sub, auditCtx);
  }

  @Post(':id/reschedule')
  @RequireAnyPermission('appointments:reschedule', 'appointments:reschedule-own')
  async reschedule(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RescheduleAppointmentDto,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnPatientScopeUnless(
      clinicId,
      user,
      'appointments:reschedule',
    );
    return this.appointmentsService.reschedule(clinicId, id, dto, user.sub, scope, auditCtx);
  }

  @Post(':id/cancel')
  @RequireAnyPermission('appointments:cancel', 'appointments:cancel-own')
  async cancel(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CancelAppointmentDto,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnPatientScopeUnless(clinicId, user, 'appointments:cancel');
    return this.appointmentsService.cancel(clinicId, id, dto, user.sub, scope, auditCtx);
  }

  @Post(':id/confirm')
  @RequirePermissions('appointments:confirm')
  async confirm(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.appointmentsService.confirm(requireClinicId(tenant), id, user.sub, auditCtx);
  }

  @Post(':id/check-in')
  @RequirePermissions('appointments:update-status')
  async checkIn(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.appointmentsService.checkIn(requireClinicId(tenant), id, user.sub, auditCtx);
  }

  @Post(':id/waiting')
  @RequirePermissions('appointments:update-status')
  async waiting(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.appointmentsService.waiting(requireClinicId(tenant), id, user.sub, auditCtx);
  }

  @Post(':id/start')
  @RequirePermissions('appointments:update-status')
  async start(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    return this.appointmentsService.start(clinicId, id, user.sub, scope, auditCtx);
  }

  @Post(':id/complete')
  @RequirePermissions('appointments:update-status')
  async complete(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScope(clinicId, user);
    return this.appointmentsService.complete(clinicId, id, user.sub, scope, auditCtx);
  }

  @Post(':id/no-show')
  @RequirePermissions('appointments:update-status')
  async noShow(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.appointmentsService.noShow(requireClinicId(tenant), id, user.sub, auditCtx);
  }

  /** A caller with a Doctor profile in this clinic is always scoped to their own appointments for status actions. */
  private async resolveOwnDoctorScope(clinicId: string, user: JwtPayload) {
    const ownDoctor = await this.doctorsService.findOwn(clinicId, user.sub).catch(() => null);
    return ownDoctor ? { doctorId: ownDoctor.id } : undefined;
  }

  /** Restricts to the caller's own patient record unless they hold the broader staff-wide permission. */
  private async resolveOwnPatientScopeUnless(
    clinicId: string,
    user: JwtPayload,
    staffPermission: string,
  ) {
    if (user.permissions.includes(staffPermission)) return undefined;
    const own = await this.patientsService.findOwn(clinicId, user.sub);
    return { patientId: own.id };
  }

  private async resolveReadScope(clinicId: string, user: JwtPayload) {
    if (user.permissions.includes('appointments:read')) {
      const ownDoctor = await this.doctorsService.findOwn(clinicId, user.sub).catch(() => null);
      return ownDoctor ? { doctorId: ownDoctor.id } : undefined;
    }
    const own = await this.patientsService.findOwn(clinicId, user.sub);
    return { patientId: own.id };
  }
}
