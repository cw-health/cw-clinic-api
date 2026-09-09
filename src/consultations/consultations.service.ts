import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Consultation, Prisma } from '@prisma/client';
import { AppointmentsService } from '../appointments/appointments.service';
import { AuditActions } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import type { AuditRequestContext } from '../common/decorators/audit-context.decorator';
import { DoctorsService } from '../doctors/doctors.service';
import { PatientsService } from '../patients/patients.service';
import { PrismaService } from '../prisma/prisma.service';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import { assertScopedWrite } from '../common/scoped-write.util';
import type { AmendConsultationDto } from './dto/amend-consultation.dto';
import type { ConsultationAmendmentResponseDto } from './dto/consultation-amendment-response.dto';
import type { ConsultationResponseDto, ConsultationStatus } from './dto/consultation-response.dto';
import type { CreateConsultationDto } from './dto/create-consultation.dto';
import type { QueryConsultationsDto } from './dto/query-consultations.dto';
import type { UpdateConsultationDto } from './dto/update-consultation.dto';

/** A caller restricted to their own Doctor record — undefined means no restriction (mirrors appointments/OwnershipScope). */
export interface DoctorOwnershipScope {
  doctorId?: string;
}

@Injectable()
export class ConsultationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appointmentsService: AppointmentsService,
    private readonly doctorsService: DoctorsService,
    private readonly patientsService: PatientsService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Starts (if needed) and creates the structured consultation record for an
   * appointment. The appointment must already be WAITING or IN_CONSULTATION
   * — a consultation can't be opened before the patient has been called
   * into the queue. If still WAITING, this transitions it via the existing
   * AppointmentsService.start() (single source of truth for the state
   * machine — this module never writes Appointment.status itself).
   */
  async create(
    clinicId: string,
    createdByUserId: string,
    dto: CreateConsultationDto,
    scope?: DoctorOwnershipScope,
    reqCtx?: AuditRequestContext,
  ): Promise<ConsultationResponseDto> {
    const appointment = await this.appointmentsService.getAppointmentRow(
      clinicId,
      dto.appointmentId,
    );
    if (!appointment) throw new NotFoundException('Appointment not found');
    if (scope?.doctorId && appointment.doctorId !== scope.doctorId) {
      throw new ForbiddenException('Not your appointment');
    }
    if (!['WAITING', 'IN_CONSULTATION'].includes(appointment.status)) {
      throw new ConflictException(
        `Cannot start a consultation for an appointment in status ${appointment.status}`,
      );
    }

    // Every tenant-scoped Prisma query includes clinicId (docs/SECURITY.md
    // §4) — appointmentId alone happens to already be tenant-verified above
    // via getAppointmentRow(clinicId, ...), but this must not rely on that.
    const existing = await this.prisma.consultation.findFirst({
      where: { clinicId, appointmentId: dto.appointmentId, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException('A consultation already exists for this appointment');
    }

    if (appointment.status === 'WAITING') {
      await this.appointmentsService.start(clinicId, dto.appointmentId, createdByUserId, scope);
    }

    const { appointmentId, followUpDate, ...fields } = dto;
    let created: Consultation;
    try {
      created = await this.prisma.consultation.create({
        data: {
          ...fields,
          followUpDate: followUpDate ? new Date(followUpDate) : undefined,
          clinicId,
          appointmentId,
          doctorId: appointment.doctorId,
          patientId: appointment.patientId,
          createdByUserId,
        },
      });
    } catch (error) {
      // Race: two concurrent creates for the same appointment — the DB's
      // unique(appointmentId) constraint is the actual enforcement point.
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('A consultation already exists for this appointment');
      }
      throw error;
    }

    await this.auditService.record({
      clinicId,
      actorUserId: createdByUserId,
      entity: 'Consultation',
      entityId: created.id,
      action: AuditActions.CONSULTATION_CREATED,
      ...reqCtx,
    });

    return this.toResponseDto(clinicId, created);
  }

  async findAll(
    clinicId: string,
    query: QueryConsultationsDto,
  ): Promise<PaginatedResult<ConsultationResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.ConsultationWhereInput = {
      clinicId,
      deletedAt: null,
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.doctorId ? { doctorId: query.doctorId } : {}),
      ...(query.appointmentId ? { appointmentId: query.appointmentId } : {}),
    };

    const [total, consultations] = await this.prisma.$transaction([
      this.prisma.consultation.count({ where }),
      this.prisma.consultation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const data = await Promise.all(consultations.map((c) => this.toResponseDto(clinicId, c)));
    return { data, meta: { total, page, pageSize } };
  }

  async findById(clinicId: string, id: string): Promise<ConsultationResponseDto> {
    const consultation = await this.findActiveOrThrow(clinicId, id);
    return this.toResponseDto(clinicId, consultation);
  }

  /**
   * Single-record PHI access surface — call only from `GET /consultations/:id`,
   * never from an internal cross-service lookup (mirrors PatientsService/
   * DoctorsService.findByIdAudited). A consultation record carries chief
   * complaint, diagnosis, and vitals — reading one is a PHI access event.
   */
  async findByIdAudited(
    clinicId: string,
    id: string,
    actorUserId: string,
    reqCtx?: AuditRequestContext,
  ): Promise<ConsultationResponseDto> {
    const consultation = await this.findById(clinicId, id);
    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Consultation',
      entityId: id,
      action: AuditActions.CONSULTATION_VIEWED,
      ...reqCtx,
    });
    return consultation;
  }

  async update(
    clinicId: string,
    id: string,
    dto: UpdateConsultationDto,
    actorUserId: string,
    scope?: DoctorOwnershipScope,
    reqCtx?: AuditRequestContext,
  ): Promise<ConsultationResponseDto> {
    const existing = await this.findActiveOrThrow(clinicId, id, scope);
    if (existing.status === 'COMPLETED') {
      throw new ConflictException('Cannot update a completed consultation');
    }
    const { followUpDate, ...fields } = dto;
    // Scoped at the query level, not only by the findActiveOrThrow check
    // above — see scoped-write.util.ts.
    const result = await this.prisma.consultation.updateMany({
      where: { id, clinicId },
      data: { ...fields, followUpDate: followUpDate ? new Date(followUpDate) : undefined },
    });
    assertScopedWrite(result, 'Consultation not found');

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Consultation',
      entityId: id,
      action: AuditActions.CONSULTATION_UPDATED,
      // Field names only — a consultation's values (diagnosis, symptoms,
      // vitals) are clinical record content, never written to AuditLog
      // (docs/SECURITY.md §8).
      changedFields: Object.keys(dto).join(','),
      ...reqCtx,
    });

    return this.findById(clinicId, id);
  }

  /** Completes the consultation and, in the same action, the linked appointment (plan: "one action finishes both"). */
  async complete(
    clinicId: string,
    id: string,
    actorUserId: string,
    scope?: DoctorOwnershipScope,
    reqCtx?: AuditRequestContext,
  ): Promise<ConsultationResponseDto> {
    const existing = await this.findActiveOrThrow(clinicId, id, scope);
    if (existing.status === 'COMPLETED') {
      throw new ConflictException('Consultation is already completed');
    }

    const appointment = await this.appointmentsService.getAppointmentRow(
      clinicId,
      existing.appointmentId,
    );
    if (appointment && appointment.status !== 'COMPLETED') {
      await this.appointmentsService.complete(clinicId, existing.appointmentId, actorUserId, scope);
    }

    const result = await this.prisma.consultation.updateMany({
      where: { id, clinicId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    assertScopedWrite(result, 'Consultation not found');

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Consultation',
      entityId: id,
      action: AuditActions.CONSULTATION_COMPLETED,
      ...reqCtx,
    });

    return this.findById(clinicId, id);
  }

  /**
   * Controlled amendment of a COMPLETED consultation (docs/DATABASE.md
   * §16) — the only way to change a locked consultation's clinical
   * fields; a plain `update()` stays hard-blocked on COMPLETED (see
   * above). Requires the separate `consultations:amend` permission
   * (never just `consultations:update`) and a reason, and writes both an
   * append-only `ConsultationAmendment` row (the clinical-record version
   * history — previous values live here, never in the platform AuditLog,
   * per docs/SECURITY.md §8) and the usual AuditLog entry (field names
   * only).
   */
  async amend(
    clinicId: string,
    id: string,
    dto: AmendConsultationDto,
    actorUserId: string,
    scope?: DoctorOwnershipScope,
    reqCtx?: AuditRequestContext,
  ): Promise<ConsultationResponseDto> {
    const existing = await this.findActiveOrThrow(clinicId, id, scope);
    if (existing.status !== 'COMPLETED') {
      throw new ConflictException(
        'Only a completed consultation can be amended — use the ordinary update instead',
      );
    }

    const { reason, followUpDate, ...fields } = dto;
    const changedKeys = Object.keys(fields).filter(
      (key) => fields[key as keyof typeof fields] !== undefined,
    );
    if (followUpDate !== undefined) changedKeys.push('followUpDate');
    if (changedKeys.length === 0) {
      throw new ConflictException('No fields supplied to amend');
    }

    const previousValues: Record<string, unknown> = {};
    for (const key of changedKeys) {
      previousValues[key] = existing[key as keyof Consultation] ?? null;
    }

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.consultation.updateMany({
        where: { id, clinicId },
        data: { ...fields, followUpDate: followUpDate ? new Date(followUpDate) : undefined },
      });
      assertScopedWrite(result, 'Consultation not found');

      await tx.consultationAmendment.create({
        data: {
          clinicId,
          consultationId: id,
          amendedByUserId: actorUserId,
          reason,
          changedFields: changedKeys.join(','),
          previousValues: JSON.stringify(previousValues),
        },
      });
    });

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Consultation',
      entityId: id,
      action: AuditActions.CONSULTATION_AMENDED,
      changedFields: changedKeys.join(','),
      ...reqCtx,
    });

    return this.findById(clinicId, id);
  }

  async findAmendments(
    clinicId: string,
    id: string,
    scope?: DoctorOwnershipScope,
  ): Promise<ConsultationAmendmentResponseDto[]> {
    await this.findActiveOrThrow(clinicId, id, scope);
    const rows = await this.prisma.consultationAmendment.findMany({
      where: { clinicId, consultationId: id },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      consultationId: row.consultationId,
      amendedByUserId: row.amendedByUserId,
      reason: row.reason,
      changedFields: row.changedFields,
      previousValues: JSON.parse(row.previousValues) as Record<string, unknown>,
      createdAt: row.createdAt,
    }));
  }

  private async findActiveOrThrow(
    clinicId: string,
    id: string,
    scope?: DoctorOwnershipScope,
  ): Promise<Consultation> {
    const consultation = await this.prisma.consultation.findFirst({
      where: { id, clinicId, deletedAt: null },
    });
    if (!consultation) throw new NotFoundException('Consultation not found');
    if (scope?.doctorId && consultation.doctorId !== scope.doctorId) {
      throw new ForbiddenException('Not your consultation');
    }
    return consultation;
  }

  private async toResponseDto(
    clinicId: string,
    consultation: Consultation,
  ): Promise<ConsultationResponseDto> {
    const [doctorName, patientName] = await Promise.all([
      this.doctorsService
        .findById(clinicId, consultation.doctorId)
        .then((d) => `${d.firstName} ${d.lastName}`)
        .catch(() => 'Unknown doctor'),
      this.patientsService
        .findById(clinicId, consultation.patientId)
        .then((p) => `${p.firstName} ${p.lastName}`)
        .catch(() => 'Unknown patient'),
    ]);

    return {
      id: consultation.id,
      clinicId: consultation.clinicId,
      appointmentId: consultation.appointmentId,
      doctorId: consultation.doctorId,
      doctorName,
      patientId: consultation.patientId,
      patientName,
      status: consultation.status as ConsultationStatus,
      chiefComplaint: consultation.chiefComplaint,
      symptoms: consultation.symptoms,
      history: consultation.history,
      heightCm: consultation.heightCm,
      weightKg: consultation.weightKg,
      temperatureCelsius: consultation.temperatureCelsius,
      pulseBpm: consultation.pulseBpm,
      bloodPressureSystolic: consultation.bloodPressureSystolic,
      bloodPressureDiastolic: consultation.bloodPressureDiastolic,
      respiratoryRate: consultation.respiratoryRate,
      spo2Percent: consultation.spo2Percent,
      examination: consultation.examination,
      diagnosis: consultation.diagnosis,
      investigations: consultation.investigations,
      treatment: consultation.treatment,
      advice: consultation.advice,
      followUpDate: consultation.followUpDate,
      followUpInstructions: consultation.followUpInstructions,
      notes: consultation.notes,
      templateKey: consultation.templateKey,
      customFields: consultation.customFields,
      createdByUserId: consultation.createdByUserId,
      completedAt: consultation.completedAt,
      createdAt: consultation.createdAt,
      updatedAt: consultation.updatedAt,
    };
  }

  /**
   * Cross-tenant by design, same rationale as
   * AppointmentsService.findUpcomingForReminder — the Phase 8 reminder cron
   * (src/reminders/reminders.service.ts) has no single request-tenant
   * context; each returned row still carries its own clinicId.
   */
  async findFollowUpsDue(
    dayStart: Date,
    dayEnd: Date,
  ): Promise<Array<{ id: string; clinicId: string; patientUserId: string | null }>> {
    const rows = await this.prisma.consultation.findMany({
      where: {
        deletedAt: null,
        followUpDate: { gte: dayStart, lt: dayEnd },
      },
      select: {
        id: true,
        clinicId: true,
        patient: { select: { userId: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      clinicId: row.clinicId,
      patientUserId: row.patient.userId,
    }));
  }
}
