import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, QueueEntry } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import type { AppointmentResponseDto } from '../appointments/dto/appointment-response.dto';
import { AuditActions } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import { ClinicsService } from '../clinics/clinics.service';
import { clinicDayRange } from '../common/clinic-day.util';
import type { QueueEntryResponseDto, QueueEntryStatus } from './dto/queue-entry-response.dto';

/** Mirrors AppointmentsService's OwnershipScope — a doctor is restricted to their own queue entries. */
export interface QueueOwnershipScope {
  doctorId?: string;
}

/**
 * **Today's operational queue** — see the doc comment on `model QueueEntry`
 * in schema.prisma for the full design rationale. In one sentence: this
 * service owns `QueueEntry` (token/position/operational status), but the
 * moment an operation actually changes what stage of *care* a patient is
 * in (waiting for a slot → in the room → done), it delegates to
 * `AppointmentsService`'s existing transition methods
 * (`waiting()`/`start()`/`complete()`/`noShow()`) rather than writing
 * `Appointment.status` itself — `AppointmentsService` stays the only place
 * `ALLOWED_TRANSITIONS` is enforced (preserving the original "queue
 * delegates to AppointmentsService" decision), and this service never
 * touches the `Appointment` Prisma model directly (module boundary,
 * docs/ARCHITECTURE.md §3) — only `AppointmentsService.getAppointmentRow`/
 * `getAppointmentsByIds` for reads.
 *
 * Concurrency (docs/DATABASE.md's queue section): every mutation here is
 * an atomic conditional update — `queueEntry.updateMany({ where: { id,
 * status: <expected> }, data })`, then checking `count === 1` — never a
 * plain read-then-write. That's what makes "two receptionists/doctors
 * acting on the same queue at once" safe: only one caller's UPDATE can
 * match the WHERE clause for a given row, so the loser sees `count === 0`
 * and either retries against the next candidate (`callNext`) or gets a
 * `ConflictException` telling it to refresh (`skip`/`start`/`complete`/
 * `no-show`/`recall`). Token generation additionally runs inside a
 * Serializable transaction (`allocateAndCreate`), backstopped by the
 * `(clinicId, doctorId, queueDate, tokenNumber)` unique index — the same
 * "isolation + retry + a unique index as the last line of defense"
 * pattern `AppointmentsService.assertNoOverlap` already uses.
 */
@Injectable()
export class QueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appointmentsService: AppointmentsService,
    private readonly clinicsService: ClinicsService,
    private readonly auditService: AuditService,
  ) {}

  // ---- reads ----

  async findClinicQueue(clinicId: string): Promise<QueueEntryResponseDto[]> {
    return this.findTodayQueue(clinicId);
  }

  async findOwnQueue(clinicId: string, doctorId: string): Promise<QueueEntryResponseDto[]> {
    return this.findTodayQueue(clinicId, { doctorId });
  }

  private async findTodayQueue(
    clinicId: string,
    scope?: QueueOwnershipScope,
  ): Promise<QueueEntryResponseDto[]> {
    const clinic = await this.clinicsService.getOwnClinic(clinicId);
    const { dayStart } = clinicDayRange(clinic.timezone);

    const entries = await this.prisma.queueEntry.findMany({
      where: {
        clinicId,
        queueDate: dayStart,
        ...(scope?.doctorId ? { doctorId: scope.doctorId } : {}),
      },
      orderBy: { tokenNumber: 'asc' },
    });
    return this.toResponseDtos(clinicId, entries, clinic.timezone);
  }

  // ---- generate token ----

  /**
   * Issues today's queue token for a checked-in appointment — idempotent
   * (re-issuing for an appointment that already has one today just returns
   * it, so a double-click front-end retry can't create a second token).
   * If the appointment is still `CHECKED_IN`, transitions it to `WAITING`
   * first via `AppointmentsService.waiting()` (the existing transition —
   * queue never invents a new one).
   */
  async generateToken(
    clinicId: string,
    appointmentId: string,
    actorUserId: string,
  ): Promise<QueueEntryResponseDto> {
    const already = await this.prisma.queueEntry.findUnique({ where: { appointmentId } });
    if (already && already.clinicId === clinicId) {
      return this.toResponseDto(already);
    }

    const appointment = await this.appointmentsService.getAppointmentRow(clinicId, appointmentId);
    if (!appointment) throw new NotFoundException('Appointment not found');
    if (!['CHECKED_IN', 'WAITING'].includes(appointment.status)) {
      throw new ConflictException(
        `Cannot issue a queue token for an appointment in status ${appointment.status}`,
      );
    }
    if (appointment.status === 'CHECKED_IN') {
      await this.appointmentsService.waiting(clinicId, appointmentId, actorUserId);
    }

    const clinic = await this.clinicsService.getOwnClinic(clinicId);
    const { dayStart } = clinicDayRange(clinic.timezone);

    const entry = await withSerializableRetry(async () => {
      // Re-checked on every attempt: if a concurrent call for the *same*
      // appointment already won, this short-circuits instead of racing
      // for a second token.
      const winner = await this.prisma.queueEntry.findUnique({ where: { appointmentId } });
      if (winner) return winner;

      return this.prisma.$transaction(
        async (tx) => {
          const tokenNumber = await this.nextTokenNumber(
            tx,
            clinicId,
            appointment.doctorId,
            dayStart,
          );
          return tx.queueEntry.create({
            data: {
              clinicId,
              doctorId: appointment.doctorId,
              appointmentId,
              queueDate: dayStart,
              tokenNumber,
              status: 'WAITING',
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    });

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'QueueEntry',
      entityId: entry.id,
      action: AuditActions.QUEUE_TOKEN_GENERATED,
      changedFields: `tokenNumber=${entry.tokenNumber}`,
    });
    return this.toResponseDto(entry);
  }

  // ---- call next (doctor mobile's single-tap flow — preserves the pre-upgrade UX:
  // calling next both announces AND starts the consultation in one action) ----

  async callNext(
    clinicId: string,
    doctorId: string,
    actorUserId: string,
  ): Promise<QueueEntryResponseDto> {
    const clinic = await this.clinicsService.getOwnClinic(clinicId);
    const { dayStart } = clinicDayRange(clinic.timezone);

    const claimed = await this.claimEarliestWaiting(clinicId, doctorId, dayStart);
    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'QueueEntry',
      entityId: claimed.id,
      action: AuditActions.QUEUE_CALLED,
      changedFields: 'status=CALLED (call-next)',
    });
    return this.startClaimedConsultation(claimed, actorUserId, { doctorId });
  }

  // ---- recall ----

  /**
   * `CALLED` -> re-announce (bumps `calledAt`/`calledCount`, stays
   * `CALLED`). `SKIPPED` -> requeued at the back of today's line with a
   * fresh token (their old token number stays retired — recomputing
   * `position` from a reused/earlier number would jump them ahead of
   * patients who were never skipped).
   */
  async recall(
    clinicId: string,
    appointmentId: string,
    actorUserId: string,
    scope?: QueueOwnershipScope,
  ): Promise<QueueEntryResponseDto> {
    const entry = await this.findEntryOrThrow(clinicId, appointmentId, scope);

    if (entry.status === 'CALLED') {
      await this.claimStatus(entry.id, ['CALLED'], {
        calledAt: new Date(),
        calledCount: { increment: 1 },
      });
    } else if (entry.status === 'SKIPPED') {
      const clinic = await this.clinicsService.getOwnClinic(clinicId);
      const { dayStart } = clinicDayRange(clinic.timezone);
      await withSerializableRetry(() =>
        this.prisma.$transaction(
          async (tx) => {
            const tokenNumber = await this.nextTokenNumber(tx, clinicId, entry.doctorId, dayStart);
            const result = await tx.queueEntry.updateMany({
              where: { id: entry.id, status: 'SKIPPED' },
              data: { status: 'WAITING', tokenNumber, skippedAt: null },
            });
            if (result.count !== 1) {
              throw new ConflictException('Queue entry status changed — please retry');
            }
          },
          { isolationLevel: 'Serializable' },
        ),
      );
    } else {
      throw new ConflictException(`Cannot recall a queue entry in status ${entry.status}`);
    }

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'QueueEntry',
      entityId: entry.id,
      action: AuditActions.QUEUE_RECALLED,
    });
    const updated = await this.prisma.queueEntry.findUniqueOrThrow({ where: { id: entry.id } });
    return this.toResponseDto(updated);
  }

  // ---- skip ----

  /** Passes over this token in the calling order — the underlying Appointment is untouched (still WAITING). */
  async skip(
    clinicId: string,
    appointmentId: string,
    actorUserId: string,
  ): Promise<QueueEntryResponseDto> {
    const entry = await this.findEntryOrThrow(clinicId, appointmentId);
    if (!isOneOf(entry.status, ['WAITING', 'CALLED'])) {
      throw new ConflictException(`Cannot skip a queue entry in status ${entry.status}`);
    }
    await this.claimStatus(entry.id, [entry.status as QueueEntryStatus], {
      status: 'SKIPPED',
      skippedAt: new Date(),
    });
    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'QueueEntry',
      entityId: entry.id,
      action: AuditActions.QUEUE_SKIPPED,
    });
    const updated = await this.prisma.queueEntry.findUniqueOrThrow({ where: { id: entry.id } });
    return this.toResponseDto(updated);
  }

  // ---- mark consultation started ----

  /**
   * Explicit, granular alternative to `callNext` (used by the reception
   * board and by a doctor picking up a specific token rather than "just
   * the next one"): starts from `WAITING` or `CALLED`.
   */
  async startConsultation(
    clinicId: string,
    appointmentId: string,
    actorUserId: string,
    scope?: QueueOwnershipScope,
  ): Promise<QueueEntryResponseDto> {
    const entry = await this.findEntryOrThrow(clinicId, appointmentId, scope);
    if (entry.status === 'WAITING') {
      await this.claimStatus(entry.id, ['WAITING'], {
        status: 'CALLED',
        calledAt: new Date(),
        calledCount: { increment: 1 },
      });
      entry.status = 'CALLED';
    } else if (entry.status !== 'CALLED') {
      throw new ConflictException(`Cannot start consultation from queue status ${entry.status}`);
    }
    return this.startClaimedConsultation(entry, actorUserId, scope);
  }

  // ---- mark completed ----

  async completeConsultation(
    clinicId: string,
    appointmentId: string,
    actorUserId: string,
    scope?: QueueOwnershipScope,
  ): Promise<QueueEntryResponseDto> {
    const entry = await this.findEntryOrThrow(clinicId, appointmentId, scope);
    if (entry.status !== 'IN_CONSULTATION') {
      throw new ConflictException(`Cannot complete a queue entry in status ${entry.status}`);
    }
    await this.claimStatus(entry.id, ['IN_CONSULTATION'], {
      status: 'COMPLETED',
      completedAt: new Date(),
    });
    try {
      await this.appointmentsService.complete(clinicId, appointmentId, actorUserId, scope);
    } catch (err) {
      await this.prisma.queueEntry.updateMany({
        where: { id: entry.id, status: 'COMPLETED' },
        data: { status: 'IN_CONSULTATION', completedAt: null },
      });
      throw err;
    }
    const updated = await this.prisma.queueEntry.findUniqueOrThrow({ where: { id: entry.id } });
    return this.toResponseDto(updated);
  }

  // ---- no-show ----

  /** A queued patient who never answered a call (or was never called before the day moved on). */
  async markNoShow(
    clinicId: string,
    appointmentId: string,
    actorUserId: string,
  ): Promise<QueueEntryResponseDto> {
    const entry = await this.findEntryOrThrow(clinicId, appointmentId);
    if (!isOneOf(entry.status, ['WAITING', 'CALLED', 'SKIPPED'])) {
      throw new ConflictException(
        `Cannot mark no-show for a queue entry in status ${entry.status}`,
      );
    }
    const priorStatus = entry.status as QueueEntryStatus;
    await this.claimStatus(entry.id, [priorStatus], { status: 'NO_SHOW', noShowAt: new Date() });
    try {
      await this.appointmentsService.noShow(clinicId, appointmentId, actorUserId);
    } catch (err) {
      await this.prisma.queueEntry.updateMany({
        where: { id: entry.id, status: 'NO_SHOW' },
        data: { status: priorStatus, noShowAt: null },
      });
      throw err;
    }
    const updated = await this.prisma.queueEntry.findUniqueOrThrow({ where: { id: entry.id } });
    return this.toResponseDto(updated);
  }

  // ---- internals ----

  /**
   * WAITING -> CALLED, atomically claiming whichever entry is currently
   * earliest by token number. Retries against the next candidate if a
   * concurrent caller won the row first — this (not the transaction below)
   * is what stops two doctors/receptionists calling next at the same
   * moment from both landing on the same patient.
   */
  private async claimEarliestWaiting(
    clinicId: string,
    doctorId: string,
    queueDate: Date,
  ): Promise<QueueEntry> {
    const MAX_ATTEMPTS = 8;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const candidate = await this.prisma.queueEntry.findFirst({
        where: { clinicId, doctorId, queueDate, status: 'WAITING' },
        orderBy: { tokenNumber: 'asc' },
      });
      if (!candidate) throw new NotFoundException('No patients waiting in the queue');

      const result = await this.prisma.queueEntry.updateMany({
        where: { id: candidate.id, status: 'WAITING' },
        data: { status: 'CALLED', calledAt: new Date(), calledCount: { increment: 1 } },
      });
      if (result.count === 1) {
        return this.prisma.queueEntry.findUniqueOrThrow({ where: { id: candidate.id } });
      }
      // Lost the race for `candidate` — someone else claimed it between the
      // read and the conditional write above; loop and try whichever
      // entry is now earliest.
    }
    throw new ConflictException('Could not claim the next patient in the queue — please retry');
  }

  /** CALLED -> IN_CONSULTATION, then delegates the authoritative Appointment transition. */
  private async startClaimedConsultation(
    entry: QueueEntry,
    actorUserId: string,
    scope?: QueueOwnershipScope,
  ): Promise<QueueEntryResponseDto> {
    await this.claimStatus(entry.id, ['CALLED'], {
      status: 'IN_CONSULTATION',
      consultationStartedAt: new Date(),
    });
    try {
      await this.appointmentsService.start(entry.clinicId, entry.appointmentId, actorUserId, scope);
    } catch (err) {
      await this.prisma.queueEntry.updateMany({
        where: { id: entry.id, status: 'IN_CONSULTATION' },
        data: { status: 'CALLED', consultationStartedAt: null },
      });
      throw err;
    }
    const updated = await this.prisma.queueEntry.findUniqueOrThrow({ where: { id: entry.id } });
    return this.toResponseDto(updated);
  }

  /** Atomic conditional update: `count !== 1` means the entry no longer matches `fromStatuses` — a lost race, not a bug. */
  private async claimStatus(
    id: string,
    fromStatuses: QueueEntryStatus[],
    data: Prisma.QueueEntryUpdateManyMutationInput,
  ): Promise<void> {
    const result = await this.prisma.queueEntry.updateMany({
      where: { id, status: { in: fromStatuses } },
      data,
    });
    if (result.count !== 1) {
      throw new ConflictException('Queue entry status changed — please refresh and try again');
    }
  }

  private async findEntryOrThrow(
    clinicId: string,
    appointmentId: string,
    scope?: QueueOwnershipScope,
  ): Promise<QueueEntry> {
    const entry = await this.prisma.queueEntry.findFirst({ where: { appointmentId, clinicId } });
    if (!entry) throw new NotFoundException('No queue entry found for this appointment today');
    if (scope?.doctorId && entry.doctorId !== scope.doctorId) {
      throw new ForbiddenException('Not your patient');
    }
    return entry;
  }

  /** Next sequential token for (clinicId, doctorId, queueDate) — caller supplies the transaction. */
  private async nextTokenNumber(
    tx: Prisma.TransactionClient,
    clinicId: string,
    doctorId: string,
    queueDate: Date,
  ): Promise<number> {
    const last = await tx.queueEntry.findFirst({
      where: { clinicId, doctorId, queueDate },
      orderBy: { tokenNumber: 'desc' },
    });
    return (last?.tokenNumber ?? 0) + 1;
  }

  private async toResponseDto(entry: QueueEntry): Promise<QueueEntryResponseDto> {
    const clinic = await this.clinicsService.getOwnClinic(entry.clinicId);
    const [appointment] = await this.appointmentsService.getAppointmentsByIds(entry.clinicId, [
      entry.appointmentId,
    ]);
    const position = await this.computePosition(entry);
    return mapQueueEntry(entry, appointment, position, clinic.timezone);
  }

  private async toResponseDtos(
    clinicId: string,
    entries: QueueEntry[],
    timezone: string,
  ): Promise<QueueEntryResponseDto[]> {
    if (entries.length === 0) return [];
    const appointments = await this.appointmentsService.getAppointmentsByIds(
      clinicId,
      entries.map((e) => e.appointmentId),
    );
    const byId = new Map(appointments.map((a) => [a.id, a]));

    // `entries` is already ordered by tokenNumber asc (the only query this
    // is ever called with) — position is a running per-doctor count over
    // WAITING entries in that same order, no extra query needed.
    const waitingCounters = new Map<string, number>();
    return entries.map((entry) => {
      let position: number | null = null;
      if (entry.status === 'WAITING') {
        position = (waitingCounters.get(entry.doctorId) ?? 0) + 1;
        waitingCounters.set(entry.doctorId, position);
      }
      return mapQueueEntry(entry, byId.get(entry.appointmentId), position, timezone);
    });
  }

  /** Single-entry position lookup (used after a mutation, where a fresh count is worth the extra query). */
  private async computePosition(entry: QueueEntry): Promise<number | null> {
    if (entry.status !== 'WAITING') return null;
    const ahead = await this.prisma.queueEntry.count({
      where: {
        clinicId: entry.clinicId,
        doctorId: entry.doctorId,
        queueDate: entry.queueDate,
        status: 'WAITING',
        tokenNumber: { lt: entry.tokenNumber },
      },
    });
    return ahead + 1;
  }
}

function isOneOf(status: string, allowed: QueueEntryStatus[]): boolean {
  return (allowed as string[]).includes(status);
}

function mapQueueEntry(
  entry: QueueEntry,
  appointment: AppointmentResponseDto | undefined,
  position: number | null,
  timezone: string,
): QueueEntryResponseDto {
  return {
    id: entry.id,
    clinicId: entry.clinicId,
    doctorId: entry.doctorId,
    doctorName: appointment?.doctorName ?? 'Unknown doctor',
    appointmentId: entry.appointmentId,
    patientId: appointment?.patientId ?? '',
    patientName: appointment?.patientName ?? 'Unknown patient',
    queueDate: formatInTimeZone(entry.queueDate, timezone, 'yyyy-MM-dd'),
    tokenNumber: entry.tokenNumber,
    position,
    status: entry.status as QueueEntryStatus,
    appointmentStatus: appointment?.status ?? 'WAITING',
    calledAt: entry.calledAt,
    calledCount: entry.calledCount,
    consultationStartedAt: entry.consultationStartedAt,
    completedAt: entry.completedAt,
    skippedAt: entry.skippedAt,
    noShowAt: entry.noShowAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

/**
 * Retries a Serializable-transaction attempt on a transient write conflict
 * (Prisma P2034 — the documented "retry the interactive transaction" error)
 * or a unique-constraint violation (P2002 — the token-uniqueness index
 * catching a race the isolation level itself should already have
 * prevented; belt-and-suspenders). Anything else propagates immediately.
 */
async function withSerializableRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryableConflict(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 20));
    }
  }
  throw lastError;
}

function isRetryableConflict(err: unknown): boolean {
  const code = (err as { code?: string } | null | undefined)?.code;
  return code === 'P2034' || code === 'P2002';
}
