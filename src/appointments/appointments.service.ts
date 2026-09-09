import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Appointment, Prisma } from '@prisma/client';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { addMinutes } from 'date-fns';
import { PrismaService } from '../prisma/prisma.service';
import { AuditActions } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import type { AuditRequestContext } from '../common/decorators/audit-context.decorator';
import { ClinicsService } from '../clinics/clinics.service';
import { DoctorsService } from '../doctors/doctors.service';
import type { NotificationType } from '../notifications/dto/notification-response.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { PatientsService } from '../patients/patients.service';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import { assertScopedWrite } from '../common/scoped-write.util';
import type { AppointmentResponseDto, AvailableSlotDto } from './dto/appointment-response.dto';
import type { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import type { CreateAppointmentDto, CreateOwnAppointmentDto } from './dto/create-appointment.dto';
import type { CreateWalkInAppointmentDto } from './dto/create-walk-in-appointment.dto';
import type {
  AppointmentStatus,
  AppointmentType,
  QueryAppointmentsDto,
} from './dto/query-appointments.dto';
import type { QueryAvailableSlotsDto } from './dto/query-available-slots.dto';
import type { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import type { UpdateAppointmentDto } from './dto/update-appointment.dto';

/**
 * Ownership scope passed down from the controller once it has resolved
 * "is this caller restricted to their own patient/doctor record" (mirrors
 * how doctors.controller.ts/patients.controller.ts resolve `/me` ids before
 * calling the service — see docs/RBAC.md §3: permission says "can act on
 * this kind of resource", ownership says "can act on this specific
 * instance"). Undefined means "no ownership restriction" (a staff-wide
 * permission was held).
 */
export interface OwnershipScope {
  patientId?: string;
  doctorId?: string;
}

// Single source of truth for legal status transitions (plan §1.3). Every
// status-changing method in this service goes through transitionStatus(),
// which is the only place `status` is ever written.
const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  SCHEDULED: ['CONFIRMED', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['WAITING', 'CANCELLED'],
  // NO_SHOW added 2026-09-09 (queue upgrade): a checked-in patient who has
  // been sitting in the operational queue can still fail to answer a call
  // (QueueService.markNoShow) — previously only SCHEDULED/CONFIRMED could
  // reach NO_SHOW (via the reminders cron), which left no legal transition
  // for "queued but never made it into the room." Goes through the same
  // transitionStatus()/ALLOWED_TRANSITIONS chokepoint as every other
  // transition — not a new state machine, just a missing edge on this one.
  WAITING: ['IN_CONSULTATION', 'CANCELLED', 'NO_SHOW'],
  IN_CONSULTATION: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

const TERMINAL_STATUSES: AppointmentStatus[] = ['COMPLETED', 'CANCELLED', 'NO_SHOW'];

/**
 * Grace period after `startsAt` before an unattended SCHEDULED/CONFIRMED
 * appointment is auto-marked NO_SHOW by RemindersService.markNoShows()
 * (docs plan: "add automatic no-show handling only if it fits the existing
 * scheduling architecture" — it does, see reminders.service.ts). A fixed
 * constant rather than a per-clinic setting, to avoid a schema change for
 * a first pass.
 */
export const NO_SHOW_GRACE_MINUTES = 30;

/**
 * `AuditLog.actorUserId` is a plain string column with no FK (see
 * schema.prisma) — safe to use as a sentinel for the one write path in
 * this codebase that isn't triggered by an authenticated request
 * (RemindersService.markNoShows()'s cron). Every other AuditService.record
 * call in the codebase passes a real user id; this is the deliberate,
 * documented exception.
 */
export const SYSTEM_ACTOR_ID = 'system:no-show-scheduler';

type AppointmentWithRelations = Appointment;

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clinicsService: ClinicsService,
    private readonly doctorsService: DoctorsService,
    private readonly patientsService: PatientsService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    clinicId: string,
    createdByUserId: string,
    dto: CreateAppointmentDto,
    reqCtx?: AuditRequestContext,
  ): Promise<AppointmentResponseDto> {
    await this.assertDoctorAndPatientInClinic(clinicId, dto.doctorId, dto.patientId);
    return this.bookAppointment(
      clinicId,
      createdByUserId,
      {
        doctorId: dto.doctorId,
        patientId: dto.patientId,
        startsAt: dto.startsAt,
        endsAt: dto.endsAt,
        reasonForVisit: dto.reasonForVisit,
        notes: dto.notes,
        type: dto.type ?? 'SCHEDULED',
      },
      reqCtx,
    );
  }

  async createOwn(
    clinicId: string,
    userId: string,
    dto: CreateOwnAppointmentDto,
    reqCtx?: AuditRequestContext,
  ): Promise<AppointmentResponseDto> {
    const own = await this.patientsService.findOwn(clinicId, userId);
    await this.assertDoctorAndPatientInClinic(clinicId, dto.doctorId, own.id);
    return this.bookAppointment(
      clinicId,
      userId,
      {
        doctorId: dto.doctorId,
        patientId: own.id,
        startsAt: dto.startsAt,
        endsAt: dto.endsAt,
        reasonForVisit: dto.reasonForVisit,
        notes: dto.notes,
        // Patients never self-classify as FOLLOW_UP/WALK_IN — always SCHEDULED.
        type: 'SCHEDULED',
      },
      reqCtx,
    );
  }

  async findAll(
    clinicId: string,
    query: QueryAppointmentsDto,
    scope?: OwnershipScope,
  ): Promise<PaginatedResult<AppointmentResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.AppointmentWhereInput = {
      clinicId,
      ...(scope?.doctorId
        ? { doctorId: scope.doctorId }
        : query.doctorId
          ? { doctorId: query.doctorId }
          : {}),
      ...(scope?.patientId
        ? { patientId: scope.patientId }
        : query.patientId
          ? { patientId: query.patientId }
          : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            startsAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lt: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { patient: { firstName: { contains: query.search } } },
              { patient: { lastName: { contains: query.search } } },
              { patient: { mrn: { contains: query.search } } },
              { doctor: { user: { firstName: { contains: query.search } } } },
              { doctor: { user: { lastName: { contains: query.search } } } },
            ],
          }
        : {}),
    };

    const [total, appointments] = await this.prisma.$transaction([
      this.prisma.appointment.count({ where }),
      this.prisma.appointment.findMany({
        where,
        orderBy: { startsAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const data = await Promise.all(appointments.map((a) => this.toResponseDto(clinicId, a)));
    return { data, meta: { total, page, pageSize } };
  }

  async findOwn(
    clinicId: string,
    userId: string,
    query: QueryAppointmentsDto,
  ): Promise<PaginatedResult<AppointmentResponseDto>> {
    const own = await this.patientsService.findOwn(clinicId, userId);
    return this.findAll(clinicId, query, { patientId: own.id });
  }

  async findById(
    clinicId: string,
    id: string,
    scope?: OwnershipScope,
  ): Promise<AppointmentResponseDto> {
    const appointment = await this.findActiveOrThrow(clinicId, id, scope);
    return this.toResponseDto(clinicId, appointment);
  }

  async update(
    clinicId: string,
    id: string,
    dto: UpdateAppointmentDto,
    actorUserId: string,
    reqCtx?: AuditRequestContext,
  ): Promise<AppointmentResponseDto> {
    await this.findActiveOrThrow(clinicId, id);
    // Scoped at the query level, not only by the findActiveOrThrow check
    // above — see scoped-write.util.ts.
    const result = await this.prisma.appointment.updateMany({ where: { id, clinicId }, data: dto });
    assertScopedWrite(result, 'Appointment not found');
    const appointment = await this.findActiveOrThrow(clinicId, id);

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Appointment',
      entityId: id,
      action: AuditActions.APPOINTMENT_UPDATED,
      changedFields: Object.keys(dto).join(','),
      ...reqCtx,
    });

    return this.toResponseDto(clinicId, appointment);
  }

  async reschedule(
    clinicId: string,
    id: string,
    dto: RescheduleAppointmentDto,
    actorUserId: string,
    scope?: OwnershipScope,
    reqCtx?: AuditRequestContext,
  ): Promise<AppointmentResponseDto> {
    const existing = await this.findActiveOrThrow(clinicId, id, scope);
    if (!['SCHEDULED', 'CONFIRMED'].includes(existing.status)) {
      throw new ConflictException(`Cannot reschedule an appointment in status ${existing.status}`);
    }
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (startsAt >= endsAt) throw new BadRequestException('startsAt must be before endsAt');

    await this.prisma.$transaction(
      async (tx) => {
        await this.assertNoOverlap(
          tx,
          clinicId,
          existing.doctorId,
          existing.patientId,
          startsAt,
          endsAt,
          id,
        );
        const result = await tx.appointment.updateMany({
          where: { id, clinicId },
          data: { startsAt, endsAt, status: 'SCHEDULED', confirmedAt: null },
        });
        assertScopedWrite(result, 'Appointment not found');
      },
      { isolationLevel: 'Serializable' },
    );
    const updated = await this.findActiveOrThrow(clinicId, id);
    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Appointment',
      entityId: id,
      action: AuditActions.APPOINTMENT_RESCHEDULED,
      changedFields: 'startsAt,endsAt',
      ...reqCtx,
    });
    return this.toResponseDto(clinicId, updated);
  }

  async cancel(
    clinicId: string,
    id: string,
    dto: CancelAppointmentDto,
    actorUserId: string,
    scope?: OwnershipScope,
    reqCtx?: AuditRequestContext,
  ): Promise<AppointmentResponseDto> {
    const existing = await this.findActiveOrThrow(clinicId, id, scope);
    const updated = await this.transitionStatus(clinicId, existing, 'CANCELLED', {
      cancelledAt: new Date(),
      cancelledByUserId: actorUserId,
      cancellationReason: dto.reason,
    });
    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Appointment',
      entityId: id,
      action: AuditActions.APPOINTMENT_CANCELLED,
      changedFields: 'status=CANCELLED',
      ...reqCtx,
    });
    await this.notifyAppointmentEvent(clinicId, existing, 'CANCELLED');
    return updated;
  }

  async confirm(
    clinicId: string,
    id: string,
    actorUserId: string,
    reqCtx?: AuditRequestContext,
  ): Promise<AppointmentResponseDto> {
    const existing = await this.findActiveOrThrow(clinicId, id);
    const updated = await this.transitionStatus(clinicId, existing, 'CONFIRMED', {
      confirmedAt: new Date(),
    });
    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Appointment',
      entityId: id,
      action: AuditActions.APPOINTMENT_CONFIRMED,
      ...reqCtx,
    });
    await this.notifyAppointmentEvent(clinicId, existing, 'CONFIRMED');
    return updated;
  }

  async checkIn(
    clinicId: string,
    id: string,
    actorUserId: string,
    reqCtx?: AuditRequestContext,
  ): Promise<AppointmentResponseDto> {
    const existing = await this.findActiveOrThrow(clinicId, id);
    const updated = await this.transitionStatus(clinicId, existing, 'CHECKED_IN', {
      checkedInAt: new Date(),
    });
    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Appointment',
      entityId: id,
      action: AuditActions.APPOINTMENT_CHECKED_IN,
      ...reqCtx,
    });
    return updated;
  }

  async waiting(
    clinicId: string,
    id: string,
    actorUserId: string,
    reqCtx?: AuditRequestContext,
  ): Promise<AppointmentResponseDto> {
    const existing = await this.findActiveOrThrow(clinicId, id);
    const updated = await this.transitionStatus(clinicId, existing, 'WAITING', {});
    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Appointment',
      entityId: id,
      action: AuditActions.APPOINTMENT_WAITING,
      ...reqCtx,
    });
    return updated;
  }

  async start(
    clinicId: string,
    id: string,
    actorUserId: string,
    scope?: OwnershipScope,
    reqCtx?: AuditRequestContext,
  ): Promise<AppointmentResponseDto> {
    const existing = await this.findActiveOrThrow(clinicId, id, scope);
    const updated = await this.transitionStatus(clinicId, existing, 'IN_CONSULTATION', {
      consultationStartedAt: new Date(),
    });
    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Appointment',
      entityId: id,
      action: AuditActions.APPOINTMENT_STARTED,
      ...reqCtx,
    });
    return updated;
  }

  async complete(
    clinicId: string,
    id: string,
    actorUserId: string,
    scope?: OwnershipScope,
    reqCtx?: AuditRequestContext,
  ): Promise<AppointmentResponseDto> {
    const existing = await this.findActiveOrThrow(clinicId, id, scope);
    const updated = await this.transitionStatus(clinicId, existing, 'COMPLETED', {
      completedAt: new Date(),
    });
    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Appointment',
      entityId: id,
      action: AuditActions.APPOINTMENT_COMPLETED,
      ...reqCtx,
    });
    return updated;
  }

  async noShow(
    clinicId: string,
    id: string,
    actorUserId: string,
    reqCtx?: AuditRequestContext,
  ): Promise<AppointmentResponseDto> {
    const existing = await this.findActiveOrThrow(clinicId, id);
    const updated = await this.transitionStatus(clinicId, existing, 'NO_SHOW', {
      noShowAt: new Date(),
    });
    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Appointment',
      entityId: id,
      action: AuditActions.APPOINTMENT_NO_SHOW,
      ...reqCtx,
    });
    return updated;
  }

  /**
   * Cross-tenant scan for RemindersService.markNoShows() (docs plan
   * "automatic no-show handling ... if it fits the existing scheduling
   * architecture" — mirrors findUpcomingForReminder's cross-tenant shape,
   * same reasoning: a cron has no single request-tenant context). Only
   * SCHEDULED/CONFIRMED appointments are eligible — anything already
   * CHECKED_IN (including every WALK_IN, which is created straight into
   * CHECKED_IN) or terminal is correctly excluded by this status filter
   * alone, no `type` check needed.
   */
  async findOverdueForNoShow(
    cutoff: Date,
  ): Promise<Array<{ id: string; clinicId: string; startsAt: Date }>> {
    return this.prisma.appointment.findMany({
      where: {
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        startsAt: { lt: cutoff },
      },
      select: { id: true, clinicId: true, startsAt: true },
    });
  }

  /**
   * System-triggered NO_SHOW transition (RemindersService.markNoShows()).
   * Goes through the same `transitionStatus` chokepoint as the manual
   * `noShow()` above — ALLOWED_TRANSITIONS is never bypassed, only the
   * actor differs (SYSTEM_ACTOR_ID instead of an authenticated user).
   */
  async autoMarkNoShow(clinicId: string, id: string): Promise<AppointmentResponseDto> {
    const existing = await this.findActiveOrThrow(clinicId, id);
    const updated = await this.transitionStatus(clinicId, existing, 'NO_SHOW', {
      noShowAt: new Date(),
    });
    await this.auditService.record({
      clinicId,
      actorUserId: SYSTEM_ACTOR_ID,
      entity: 'Appointment',
      entityId: id,
      action: AuditActions.APPOINTMENT_NO_SHOW,
      changedFields: 'status=NO_SHOW (auto)',
    });
    return updated;
  }

  /** Cross-module raw read hook (mirrors DoctorsService.getDoctorRow) — for the consultations module. */
  async getAppointmentRow(clinicId: string, id: string): Promise<Appointment | null> {
    return this.prisma.appointment.findFirst({ where: { id, clinicId } });
  }

  /**
   * Bulk-fetch, response-shaped (doctor/patient names resolved) — for the
   * `queue` module, which owns its own `QueueEntry` rows (token/position/
   * operational status) but must never reach into `Appointment`'s Prisma
   * model directly (docs/ARCHITECTURE.md §3: a module only imports another
   * module's exported service). Order is not guaranteed to match `ids`;
   * callers re-key by `id`.
   */
  async getAppointmentsByIds(clinicId: string, ids: string[]): Promise<AppointmentResponseDto[]> {
    if (ids.length === 0) return [];
    const appointments = await this.prisma.appointment.findMany({
      where: { clinicId, id: { in: ids } },
    });
    return Promise.all(appointments.map((a) => this.toResponseDto(clinicId, a)));
  }

  /** Server-computed availability (plan §1.5) — never trust a client-submitted slot list. */
  async getAvailableSlots(
    clinicId: string,
    dto: QueryAvailableSlotsDto,
  ): Promise<AvailableSlotDto[]> {
    const doctor = await this.doctorsService.getDoctorRow(clinicId, dto.doctorId);
    if (!doctor) throw new NotFoundException('Doctor not found');
    // A deactivated doctor simply has no open slots to offer — same
    // no-new-bookings rule as assertDoctorAndPatientInClinic, but surfaced
    // as an empty slot list (this is a read, not a mutation) rather than
    // an error.
    if (doctor.status !== 'ACTIVE') return [];
    const clinic = await this.clinicsService.getOwnClinic(clinicId);
    const timeZone = clinic.timezone;

    const [year, month, day] = dto.date.split('-').map(Number);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = calendarDate.getUTCDay();

    if (await this.clinicsService.isHoliday(clinicId, calendarDate)) return [];

    const workingHours = await this.clinicsService.getWorkingHoursForDay(clinicId, dayOfWeek);
    if (
      !workingHours ||
      !workingHours.isOpen ||
      !workingHours.openTime ||
      !workingHours.closeTime
    ) {
      return [];
    }

    const availability = await this.doctorsService.getAvailabilityForDay(dto.doctorId, dayOfWeek);
    if (!availability || !availability.isActive) return [];

    const intervalStart = maxTime(workingHours.openTime, availability.startTime);
    const intervalEnd = minTime(workingHours.closeTime, availability.endTime);
    if (intervalStart >= intervalEnd) return [];

    let freeRanges: [Date, Date][] = [
      [
        toUtcInstant(dto.date, intervalStart, timeZone),
        toUtcInstant(dto.date, intervalEnd, timeZone),
      ],
    ];

    const breaks = await this.doctorsService.getBreaksForDay(dto.doctorId, dayOfWeek);
    for (const brk of breaks) {
      freeRanges = subtractRange(freeRanges, [
        toUtcInstant(dto.date, brk.startTime, timeZone),
        toUtcInstant(dto.date, brk.endTime, timeZone),
      ]);
    }

    const dayStartUtc = toUtcInstant(dto.date, '00:00', timeZone);
    const dayEndUtc = addMinutes(dayStartUtc, 24 * 60);
    const unavailability = await this.doctorsService.getUnavailabilityOverlapping(
      dto.doctorId,
      dayStartUtc,
      dayEndUtc,
    );
    for (const block of unavailability) {
      freeRanges = subtractRange(freeRanges, [block.startsAt, block.endsAt]);
    }

    const durationMinutes =
      doctor.appointmentDurationMinutes ?? clinic.defaultAppointmentDurationMinutes;

    const candidateSlots: AvailableSlotDto[] = [];
    for (const [rangeStart, rangeEnd] of freeRanges) {
      let slotStart = rangeStart;
      while (addMinutes(slotStart, durationMinutes) <= rangeEnd) {
        const slotEnd = addMinutes(slotStart, durationMinutes);
        candidateSlots.push({ startsAt: slotStart, endsAt: slotEnd });
        slotStart = slotEnd;
      }
    }
    if (candidateSlots.length === 0) return [];

    const existingAppointments = await this.prisma.appointment.findMany({
      where: {
        clinicId,
        doctorId: dto.doctorId,
        status: { not: 'CANCELLED' },
        startsAt: { lt: dayEndUtc },
        endsAt: { gt: dayStartUtc },
      },
    });

    return candidateSlots.filter(
      (slot) =>
        !existingAppointments.some((a) => a.startsAt < slot.endsAt && a.endsAt > slot.startsAt),
    );
  }

  // ---- internals ----

  private async bookAppointment(
    clinicId: string,
    createdByUserId: string,
    input: {
      doctorId: string;
      patientId: string;
      startsAt: string;
      endsAt: string;
      reasonForVisit?: string;
      notes?: string;
      type: AppointmentType;
    },
    reqCtx?: AuditRequestContext,
  ): Promise<AppointmentResponseDto> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (startsAt >= endsAt) throw new BadRequestException('startsAt must be before endsAt');
    if (startsAt < new Date()) throw new BadRequestException('startsAt must be in the future');

    const created = await this.prisma.$transaction(
      async (tx) => {
        await this.assertNoOverlap(tx, clinicId, input.doctorId, input.patientId, startsAt, endsAt);
        return tx.appointment.create({
          data: {
            clinicId,
            doctorId: input.doctorId,
            patientId: input.patientId,
            startsAt,
            endsAt,
            reasonForVisit: input.reasonForVisit,
            notes: input.notes,
            createdByUserId,
            type: input.type,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );
    // Audited only once the transaction above has actually committed — a
    // rollback (e.g. the overlap check throwing) never reaches this line,
    // so no AUDIT row is ever written for a booking that didn't happen.
    await this.auditService.record({
      clinicId,
      actorUserId: createdByUserId,
      entity: 'Appointment',
      entityId: created.id,
      action: AuditActions.APPOINTMENT_CREATED,
      ...reqCtx,
    });
    await this.notifyAppointmentEvent(clinicId, created, 'BOOKED');
    return this.toResponseDto(clinicId, created);
  }

  /**
   * Front-desk registers a walk-in (POST /appointments/walk-in) — the
   * "safe walk-in support" plan requirement. Unlike bookAppointment(),
   * there is no client-submitted slot (a walk-in has no `startsAt` to pick
   * from getAvailableSlots), so this does its own day-level availability
   * check before creating the row, and inserts directly at CHECKED_IN
   * rather than going through transitionStatus()/ALLOWED_TRANSITIONS —
   * establishing an *initial* state at creation time is a different
   * concern from a *transition* on an existing row, so the shared
   * ALLOWED_TRANSITIONS table (and every existing transition test) is
   * untouched by this. Queue integration needs no changes: findQueue/
   * callNext already match on `status IN (CHECKED_IN, WAITING,
   * IN_CONSULTATION)` for today, so the walk-in shows up immediately.
   */
  async createWalkIn(
    clinicId: string,
    actorUserId: string,
    dto: CreateWalkInAppointmentDto,
    reqCtx?: AuditRequestContext,
  ): Promise<AppointmentResponseDto> {
    const doctor = await this.doctorsService.getDoctorRow(clinicId, dto.doctorId);
    if (!doctor) throw new NotFoundException('Doctor not found');
    if (doctor.status !== 'ACTIVE') {
      throw new ConflictException('Doctor is not currently accepting appointments');
    }
    // Throws NotFoundException itself if the patient isn't in this clinic.
    await this.patientsService.findById(clinicId, dto.patientId);

    const clinic = await this.clinicsService.getOwnClinic(clinicId);
    const now = new Date();
    // Same "clinic-local calendar date -> UTC-normalized Date -> day of
    // week" derivation as getAvailableSlots below, so isHoliday/
    // getWorkingHoursForDay/getAvailabilityForDay are asked about exactly
    // the same "today" a scheduled booking would be.
    const todayDateStr = formatInTimeZone(now, clinic.timezone, 'yyyy-MM-dd');
    const [year, month, day] = todayDateStr.split('-').map(Number);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = calendarDate.getUTCDay();

    if (await this.clinicsService.isHoliday(clinicId, calendarDate)) {
      throw new ConflictException('Clinic is closed today — cannot register a walk-in');
    }
    const workingHours = await this.clinicsService.getWorkingHoursForDay(clinicId, dayOfWeek);
    if (!workingHours?.isOpen) {
      throw new ConflictException('Clinic is closed today — cannot register a walk-in');
    }
    const availability = await this.doctorsService.getAvailabilityForDay(dto.doctorId, dayOfWeek);
    if (!availability?.isActive) {
      throw new ConflictException('Doctor is not available for walk-ins today');
    }

    const duration = doctor.appointmentDurationMinutes ?? clinic.defaultAppointmentDurationMinutes;
    const startsAt = now;
    const endsAt = addMinutes(startsAt, duration);

    const created = await this.prisma.$transaction(
      async (tx) => {
        await this.assertNoOverlap(
          tx,
          clinicId,
          dto.doctorId,
          dto.patientId,
          startsAt,
          endsAt,
          undefined,
          { skipDoctorCheck: true },
        );
        return tx.appointment.create({
          data: {
            clinicId,
            doctorId: dto.doctorId,
            patientId: dto.patientId,
            startsAt,
            endsAt,
            reasonForVisit: dto.reasonForVisit,
            notes: dto.notes,
            createdByUserId: actorUserId,
            type: 'WALK_IN',
            status: 'CHECKED_IN',
            checkedInAt: now,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Appointment',
      entityId: created.id,
      action: AuditActions.APPOINTMENT_WALK_IN_CREATED,
      ...reqCtx,
    });
    return this.toResponseDto(clinicId, created);
  }

  /**
   * Double-booking prevention (plan §1.2): run inside a Serializable
   * interactive transaction so the read-then-write gap can't race a
   * concurrent booking for the same doctor or patient into an overlapping
   * slot — SQL Server has no exclusion constraint for range overlap, so
   * transaction isolation is the enforcement mechanism, not a DB constraint
   * alone (docs/DATABASE.md §2's "two complementary layers").
   *
   * `skipDoctorCheck` (only ever set by createWalkIn — bookAppointment
   * always leaves it false, so SCHEDULED/FOLLOW_UP overlap behavior is
   * unchanged): a walk-in doesn't claim a doctor's calendar slot the way a
   * scheduled appointment does — several walk-ins legitimately queue up
   * for the same doctor at the same moment, that's normal front-desk
   * operation, not a double-booking. The patient-side check always stays
   * on: a patient can't have two simultaneously-active appointments
   * regardless of how either was created.
   */
  private async assertNoOverlap(
    tx: Prisma.TransactionClient,
    clinicId: string,
    doctorId: string,
    patientId: string,
    startsAt: Date,
    endsAt: Date,
    excludeId?: string,
    options?: { skipDoctorCheck?: boolean },
  ): Promise<void> {
    const overlapWhere = (
      idField: 'doctorId' | 'patientId',
      id: string,
    ): Prisma.AppointmentWhereInput => ({
      clinicId,
      [idField]: id,
      status: { not: 'CANCELLED' },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    });

    const [doctorConflict, patientConflict] = await Promise.all([
      options?.skipDoctorCheck
        ? Promise.resolve(null)
        : tx.appointment.findFirst({ where: overlapWhere('doctorId', doctorId) }),
      tx.appointment.findFirst({ where: overlapWhere('patientId', patientId) }),
    ]);
    if (doctorConflict)
      throw new ConflictException('Doctor already has an appointment in this time range');
    if (patientConflict)
      throw new ConflictException('Patient already has an appointment in this time range');
  }

  private async transitionStatus(
    clinicId: string,
    appointment: AppointmentWithRelations,
    target: AppointmentStatus,
    extraData: Prisma.AppointmentUpdateInput,
  ): Promise<AppointmentResponseDto> {
    const current = appointment.status as AppointmentStatus;
    const legal = ALLOWED_TRANSITIONS[current] ?? [];
    if (!legal.includes(target)) {
      throw new ConflictException(`Cannot transition appointment from ${current} to ${target}`);
    }
    const result = await this.prisma.appointment.updateMany({
      where: { id: appointment.id, clinicId },
      data: { status: target, ...extraData },
    });
    assertScopedWrite(result, 'Appointment not found');
    const updated = await this.findActiveOrThrow(clinicId, appointment.id);
    return this.toResponseDto(clinicId, updated);
  }

  private async findActiveOrThrow(
    clinicId: string,
    id: string,
    scope?: OwnershipScope,
  ): Promise<AppointmentWithRelations> {
    const appointment = await this.prisma.appointment.findFirst({ where: { id, clinicId } });
    if (!appointment) throw new NotFoundException('Appointment not found');
    if (scope?.patientId && appointment.patientId !== scope.patientId) {
      throw new ForbiddenException('Not your appointment');
    }
    if (scope?.doctorId && appointment.doctorId !== scope.doctorId) {
      throw new ForbiddenException('Not your appointment');
    }
    return appointment;
  }

  /**
   * Best-effort notification fan-out to the patient's and doctor's portal
   * users (docs/ROADMAP.md Phase 7) — never allowed to fail the booking/
   * cancellation it accompanies. Either side may have no linked User
   * (Patient.userId is nullable; a Doctor row is always User-backed but is
   * looked up defensively all the same) and is simply skipped in that case.
   */
  private async notifyAppointmentEvent(
    clinicId: string,
    appointment: { id: string; doctorId: string; patientId: string },
    event: 'BOOKED' | 'CONFIRMED' | 'CANCELLED',
  ): Promise<void> {
    const [doctor, patient] = await Promise.all([
      this.doctorsService.findById(clinicId, appointment.doctorId).catch(() => null),
      this.patientsService.findById(clinicId, appointment.patientId).catch(() => null),
    ]);

    const type: NotificationType =
      event === 'BOOKED'
        ? 'APPOINTMENT_BOOKED'
        : event === 'CONFIRMED'
          ? 'APPOINTMENT_CONFIRMED'
          : 'APPOINTMENT_CANCELLED';
    const notifications: Promise<unknown>[] = [];

    if (patient?.userId) {
      const title =
        event === 'BOOKED'
          ? 'Appointment booked'
          : event === 'CONFIRMED'
            ? 'Appointment confirmed'
            : 'Appointment cancelled';
      const body =
        event === 'BOOKED'
          ? 'Your appointment has been booked.'
          : event === 'CONFIRMED'
            ? 'Your appointment has been confirmed.'
            : 'Your appointment has been cancelled.';
      notifications.push(
        this.notificationsService
          .create(clinicId, patient.userId, type, title, body, 'Appointment', appointment.id)
          .catch(() => undefined),
      );
    }
    if (doctor?.userId) {
      const title =
        event === 'BOOKED'
          ? 'New appointment scheduled'
          : event === 'CONFIRMED'
            ? 'Appointment confirmed'
            : 'Appointment cancelled';
      const body =
        event === 'BOOKED'
          ? 'A new appointment has been scheduled with you.'
          : event === 'CONFIRMED'
            ? 'An appointment with you has been confirmed.'
            : 'An appointment with you has been cancelled.';
      notifications.push(
        this.notificationsService
          .create(clinicId, doctor.userId, type, title, body, 'Appointment', appointment.id)
          .catch(() => undefined),
      );
    }
    await Promise.all(notifications);
  }

  /**
   * Cross-tenant by design (docs/ROADMAP.md Phase 8 reminder cron,
   * src/reminders/reminders.service.ts) — a scheduled job has no single
   * request-tenant context. Each returned row still carries its own
   * clinicId, which the caller uses to scope the reminder Notification it
   * creates, so no cross-tenant data is ever exposed to a client; this
   * stays the only method on this service without a clinicId parameter.
   */
  async findUpcomingForReminder(
    windowStart: Date,
    windowEnd: Date,
  ): Promise<
    Array<{ id: string; clinicId: string; startsAt: Date; patientUserId: string | null }>
  > {
    const rows = await this.prisma.appointment.findMany({
      where: {
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        startsAt: { gte: windowStart, lte: windowEnd },
      },
      select: {
        id: true,
        clinicId: true,
        startsAt: true,
        patient: { select: { userId: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      clinicId: row.clinicId,
      startsAt: row.startsAt,
      patientUserId: row.patient.userId,
    }));
  }

  private async assertDoctorAndPatientInClinic(
    clinicId: string,
    doctorId: string,
    patientId: string,
  ): Promise<void> {
    const doctor = await this.doctorsService.getDoctorRow(clinicId, doctorId);
    if (!doctor) throw new NotFoundException('Doctor not found');
    // A deactivated doctor keeps every appointment already booked against
    // them (getDoctorRow's onDelete: NoAction FK never cascades a status
    // change) but stops accepting *new* ones — same reasoning as
    // getAvailableSlots below returning no slots for a non-ACTIVE doctor.
    if (doctor.status !== 'ACTIVE') {
      throw new ConflictException('Doctor is not currently accepting appointments');
    }
    // Throws NotFoundException itself if the patient isn't in this clinic.
    await this.patientsService.findById(clinicId, patientId);
  }

  private async toResponseDto(
    clinicId: string,
    appointment: AppointmentWithRelations,
  ): Promise<AppointmentResponseDto> {
    const [doctorName, patientName] = await Promise.all([
      this.doctorsService
        .findById(clinicId, appointment.doctorId)
        .then((d) => `${d.firstName} ${d.lastName}`)
        .catch(() => 'Unknown doctor'),
      this.patientsService
        .findById(clinicId, appointment.patientId)
        .then((p) => `${p.firstName} ${p.lastName}`)
        .catch(() => 'Unknown patient'),
    ]);

    return {
      id: appointment.id,
      clinicId: appointment.clinicId,
      doctorId: appointment.doctorId,
      doctorName,
      patientId: appointment.patientId,
      patientName,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: appointment.status as AppointmentStatus,
      type: appointment.type as AppointmentType,
      reasonForVisit: appointment.reasonForVisit,
      notes: appointment.notes,
      createdByUserId: appointment.createdByUserId,
      confirmedAt: appointment.confirmedAt,
      checkedInAt: appointment.checkedInAt,
      consultationStartedAt: appointment.consultationStartedAt,
      completedAt: appointment.completedAt,
      noShowAt: appointment.noShowAt,
      cancelledAt: appointment.cancelledAt,
      cancelledByUserId: appointment.cancelledByUserId,
      cancellationReason: appointment.cancellationReason,
      createdAt: appointment.createdAt,
      updatedAt: appointment.updatedAt,
    };
  }
}

export { ALLOWED_TRANSITIONS, TERMINAL_STATUSES };

function toUtcInstant(date: string, time: string, timeZone: string): Date {
  return fromZonedTime(`${date}T${time}:00`, timeZone);
}

function maxTime(a: string, b: string): string {
  return a > b ? a : b;
}

function minTime(a: string, b: string): string {
  return a < b ? a : b;
}

/** Subtracts `sub` from every range in `ranges`, splitting a range in two when `sub` falls in its middle. */
function subtractRange(ranges: [Date, Date][], sub: [Date, Date]): [Date, Date][] {
  const [subStart, subEnd] = sub;
  const result: [Date, Date][] = [];
  for (const [start, end] of ranges) {
    if (subEnd <= start || subStart >= end) {
      result.push([start, end]);
      continue;
    }
    if (subStart > start) result.push([start, subStart]);
    if (subEnd < end) result.push([subEnd, end]);
  }
  return result;
}
