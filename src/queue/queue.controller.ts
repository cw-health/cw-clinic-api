import { Body, Controller, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { RequireAnyPermission } from '../auth/decorators/require-any-permission.decorator';
import { Tenant } from '../auth/decorators/tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/guards/tenant.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { requireClinicId } from '../common/require-clinic-id.util';
import { DoctorsService } from '../doctors/doctors.service';
import { GenerateTokenDto } from './dto/generate-token.dto';
import { QueueService } from './queue.service';

@ApiTags('queue')
@ApiBearerAuth()
@Controller({ path: 'queue', version: '1' })
export class QueueController {
  constructor(
    private readonly queueService: QueueService,
    private readonly doctorsService: DoctorsService,
  ) {}

  @Post()
  @RequirePermissions('queue:manage')
  async generateToken(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Body() dto: GenerateTokenDto,
  ) {
    return this.queueService.generateToken(requireClinicId(tenant), dto.appointmentId, user.sub);
  }

  @Get()
  @RequirePermissions('queue:manage')
  async findClinicQueue(@Tenant() tenant: TenantContext) {
    return this.queueService.findClinicQueue(requireClinicId(tenant));
  }

  // Declared ahead of the ':appointmentId/...' routes below so Nest doesn't match "me" as a param.
  @Get('me')
  @RequirePermissions('queue:manage-own')
  async findOwnQueue(@Tenant() tenant: TenantContext, @CurrentUser() user: JwtPayload) {
    const clinicId = requireClinicId(tenant);
    const doctor = await this.resolveOwnDoctor(clinicId, user);
    return this.queueService.findOwnQueue(clinicId, doctor.id);
  }

  @Post('call-next')
  @RequirePermissions('queue:manage-own')
  async callNext(@Tenant() tenant: TenantContext, @CurrentUser() user: JwtPayload) {
    const clinicId = requireClinicId(tenant);
    const doctor = await this.resolveOwnDoctor(clinicId, user);
    return this.queueService.callNext(clinicId, doctor.id, user.sub);
  }

  @Post(':appointmentId/recall')
  @RequireAnyPermission('queue:manage', 'queue:manage-own')
  async recall(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('appointmentId') appointmentId: string,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScopeUnless(clinicId, user, 'queue:manage');
    return this.queueService.recall(clinicId, appointmentId, user.sub, scope);
  }

  @Post(':appointmentId/skip')
  @RequirePermissions('queue:manage')
  async skip(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('appointmentId') appointmentId: string,
  ) {
    return this.queueService.skip(requireClinicId(tenant), appointmentId, user.sub);
  }

  @Post(':appointmentId/start')
  @RequireAnyPermission('queue:manage', 'queue:manage-own')
  async startConsultation(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('appointmentId') appointmentId: string,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScopeUnless(clinicId, user, 'queue:manage');
    return this.queueService.startConsultation(clinicId, appointmentId, user.sub, scope);
  }

  @Post(':appointmentId/complete')
  @RequireAnyPermission('queue:manage', 'queue:manage-own')
  async completeConsultation(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('appointmentId') appointmentId: string,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveOwnDoctorScopeUnless(clinicId, user, 'queue:manage');
    return this.queueService.completeConsultation(clinicId, appointmentId, user.sub, scope);
  }

  @Post(':appointmentId/no-show')
  @RequirePermissions('queue:manage')
  async noShow(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('appointmentId') appointmentId: string,
  ) {
    return this.queueService.markNoShow(requireClinicId(tenant), appointmentId, user.sub);
  }

  private async resolveOwnDoctor(clinicId: string, user: JwtPayload) {
    const doctor = await this.doctorsService.findOwn(clinicId, user.sub).catch(() => null);
    if (!doctor) {
      throw new ForbiddenException('This action requires an active Doctor profile in this clinic');
    }
    return doctor;
  }

  /**
   * Restricts a `RequireAnyPermission('queue:manage', 'queue:manage-own')`
   * route to the caller's own doctor queue unless they hold the broader
   * staff-wide permission — mirrors
   * AppointmentsController.resolveOwnPatientScopeUnless.
   */
  private async resolveOwnDoctorScopeUnless(
    clinicId: string,
    user: JwtPayload,
    staffPermission: string,
  ) {
    if (user.permissions.includes(staffPermission)) return undefined;
    const doctor = await this.resolveOwnDoctor(clinicId, user);
    return { doctorId: doctor.id };
  }
}
