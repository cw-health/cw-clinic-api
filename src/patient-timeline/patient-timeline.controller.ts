import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditActions } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
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
import { QueryPatientTimelineDto } from './dto/query-patient-timeline.dto';
import { PatientTimelineService } from './patient-timeline.service';

@ApiTags('patients')
@ApiBearerAuth()
@Controller({ path: 'patients/:id/timeline', version: '1' })
export class PatientTimelineController {
  constructor(
    private readonly patientTimelineService: PatientTimelineService,
    private readonly auditService: AuditService,
  ) {}

  // Gated on patients:read like GET /patients/:id — a PHI aggregation
  // read of one patient, not a list view, so it gets its own audit action
  // (PatientsService.findByIdAudited's own doc comment explains the same
  // single-record-vs-list distinction).
  @Get()
  @RequirePermissions('patients:read')
  async getTimeline(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Query() query: QueryPatientTimelineDto,
    @CurrentUser() user: JwtPayload,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    const clinicId = requireClinicId(tenant);
    const result = await this.patientTimelineService.getTimeline(
      clinicId,
      id,
      user.permissions,
      query,
    );
    await this.auditService.record({
      clinicId,
      actorUserId: user.sub,
      entity: 'Patient',
      entityId: id,
      action: AuditActions.PATIENT_TIMELINE_VIEWED,
      ...auditCtx,
    });
    return result;
  }
}
