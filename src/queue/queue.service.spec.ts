import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AppointmentsService } from '../appointments/appointments.service';
import type { AuditService } from '../audit/audit.service';
import type { ClinicsService } from '../clinics/clinics.service';
import type { PrismaService } from '../prisma/prisma.service';
import { QueueService } from './queue.service';

const CLINIC = 'clinic-a';
const DOCTOR_1 = 'doctor-1';
const DOCTOR_2 = 'doctor-2';
const TODAY = new Date('2026-09-09T00:00:00.000Z');

interface FakeEntry {
  id: string;
  clinicId: string;
  doctorId: string;
  appointmentId: string;
  queueDate: Date;
  tokenNumber: number;
  status: string;
  calledAt: Date | null;
  calledCount: number;
  consultationStartedAt: Date | null;
  completedAt: Date | null;
  skippedAt: Date | null;
  noShowAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function matchesWhere(entry: FakeEntry, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    const value = (entry as unknown as Record<string, unknown>)[key];
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const cond = condition as Record<string, unknown>;
      if ('in' in cond && !(cond.in as unknown[]).includes(value)) return false;
      if ('lt' in cond && !((value as Date) < (cond.lt as Date))) return false;
    } else {
      const ev = value instanceof Date ? +value : value;
      const cv = condition instanceof Date ? +condition : condition;
      if (ev !== cv) return false;
    }
  }
  return true;
}

function applyOrder(list: FakeEntry[], orderBy?: Record<string, 'asc' | 'desc'>): FakeEntry[] {
  if (!orderBy) return list;
  const [[key, dir]] = Object.entries(orderBy);
  return [...list].sort((a, b) => {
    const av = (a as unknown as Record<string, number>)[key];
    const bv = (b as unknown as Record<string, number>)[key];
    return dir === 'asc' ? av - bv : bv - av;
  });
}

function uniqueViolation(): Error {
  const err = new Error('Unique constraint failed') as Error & { code: string };
  err.code = 'P2002';
  return err;
}

/** In-memory QueueEntry table modeling the real unique constraints and atomic updateMany semantics a real DB would enforce — see queue.service.spec.ts's concurrency describe block. */
function makeFakePrisma() {
  const entries = new Map<string, FakeEntry>();
  let seq = 0;

  function find(where: Record<string, unknown>): FakeEntry | null {
    return [...entries.values()].find((e) => matchesWhere(e, where)) ?? null;
  }

  const queueEntry = {
    findUnique: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(find(where)),
    ),
    findUniqueOrThrow: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      const entry = find(where);
      if (!entry) return Promise.reject(new Error('QueueEntry not found'));
      return Promise.resolve(entry);
    }),
    findFirst: jest.fn(
      ({
        where,
        orderBy,
      }: {
        where: Record<string, unknown>;
        orderBy?: Record<string, 'asc' | 'desc'>;
      }) => {
        const list = applyOrder(
          [...entries.values()].filter((e) => matchesWhere(e, where)),
          orderBy,
        );
        return Promise.resolve(list[0] ?? null);
      },
    ),
    findMany: jest.fn(
      ({
        where,
        orderBy,
      }: {
        where: Record<string, unknown>;
        orderBy?: Record<string, 'asc' | 'desc'>;
      }) => {
        const list = applyOrder(
          [...entries.values()].filter((e) => matchesWhere(e, where)),
          orderBy,
        );
        return Promise.resolve(list);
      },
    ),
    count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve([...entries.values()].filter((e) => matchesWhere(e, where)).length),
    ),
    create: jest.fn(({ data }: { data: Partial<FakeEntry> }) => {
      const id = `qe-${++seq}`;
      const entry: FakeEntry = {
        id,
        calledAt: null,
        calledCount: 0,
        consultationStartedAt: null,
        completedAt: null,
        skippedAt: null,
        noShowAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      } as FakeEntry;

      const tokenClash = [...entries.values()].some(
        (e) =>
          e.clinicId === entry.clinicId &&
          e.doctorId === entry.doctorId &&
          +e.queueDate === +entry.queueDate &&
          e.tokenNumber === entry.tokenNumber,
      );
      const appointmentClash = [...entries.values()].some(
        (e) => e.appointmentId === entry.appointmentId,
      );
      if (tokenClash || appointmentClash) throw uniqueViolation();

      entries.set(id, entry);
      return Promise.resolve(entry);
    }),
    updateMany: jest.fn(
      ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const matches = [...entries.values()].filter((e) => matchesWhere(e, where));
        for (const entry of matches) {
          for (const [key, value] of Object.entries(data)) {
            if (value && typeof value === 'object' && 'increment' in value) {
              (entry as unknown as Record<string, number>)[key] =
                ((entry as unknown as Record<string, number>)[key] ?? 0) +
                (value as { increment: number }).increment;
            } else {
              (entry as unknown as Record<string, unknown>)[key] = value;
            }
          }
          entry.updatedAt = new Date();
        }
        return Promise.resolve({ count: matches.length });
      },
    ),
  };

  const fakePrisma = { queueEntry } as unknown as Record<string, unknown>;
  fakePrisma.$transaction = jest.fn((arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(fakePrisma);
    return Promise.all(arg as Promise<unknown>[]);
  });

  return { fakePrisma, entries };
}

function seedEntry(
  entries: Map<string, FakeEntry>,
  overrides: Partial<FakeEntry> & { id: string; appointmentId: string; tokenNumber: number },
): FakeEntry {
  const entry: FakeEntry = {
    clinicId: CLINIC,
    doctorId: DOCTOR_1,
    queueDate: TODAY,
    status: 'WAITING',
    calledAt: null,
    calledCount: 0,
    consultationStartedAt: null,
    completedAt: null,
    skippedAt: null,
    noShowAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  entries.set(entry.id, entry);
  return entry;
}

function makeAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appt-1',
    clinicId: CLINIC,
    doctorId: DOCTOR_1,
    status: 'WAITING',
    ...overrides,
  };
}

function makeAppointmentDto(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appt-1',
    clinicId: CLINIC,
    doctorId: DOCTOR_1,
    doctorName: 'Ada Lovelace',
    patientId: 'patient-1',
    patientName: 'Grace Hopper',
    status: 'WAITING',
    ...overrides,
  };
}

function makeService() {
  const { fakePrisma, entries } = makeFakePrisma();

  const appointmentsService = {
    getAppointmentRow: jest.fn().mockResolvedValue(makeAppointment()),
    getAppointmentsByIds: jest.fn((_clinicId: string, ids: string[]) =>
      Promise.resolve(ids.map((id) => makeAppointmentDto({ id }))),
    ),
    waiting: jest.fn().mockResolvedValue(undefined),
    start: jest.fn().mockResolvedValue(undefined),
    complete: jest.fn().mockResolvedValue(undefined),
    noShow: jest.fn().mockResolvedValue(undefined),
  } as unknown as AppointmentsService;

  const clinicsService = {
    getOwnClinic: jest.fn().mockResolvedValue({ id: CLINIC, timezone: 'UTC' }),
  } as unknown as ClinicsService;

  const auditService = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new QueueService(
    fakePrisma as unknown as PrismaService,
    appointmentsService,
    clinicsService,
    auditService as unknown as AuditService,
  );

  return { service, entries, appointmentsService, clinicsService, auditService };
}

describe('QueueService', () => {
  describe('generateToken', () => {
    it('issues token 1 for the first appointment of the day for a doctor', async () => {
      const { service } = makeService();
      const result = await service.generateToken(CLINIC, 'appt-1', 'user-fd');
      expect(result.tokenNumber).toBe(1);
      expect(result.status).toBe('WAITING');
    });

    it('issues sequential tokens per (clinic, doctor, day)', async () => {
      const { service, appointmentsService } = makeService();
      (appointmentsService.getAppointmentRow as jest.Mock)
        .mockResolvedValueOnce(makeAppointment({ id: 'appt-1' }))
        .mockResolvedValueOnce(makeAppointment({ id: 'appt-2' }))
        .mockResolvedValueOnce(makeAppointment({ id: 'appt-3' }));

      const t1 = await service.generateToken(CLINIC, 'appt-1', 'user-fd');
      const t2 = await service.generateToken(CLINIC, 'appt-2', 'user-fd');
      const t3 = await service.generateToken(CLINIC, 'appt-3', 'user-fd');
      expect([t1.tokenNumber, t2.tokenNumber, t3.tokenNumber]).toEqual([1, 2, 3]);
    });

    it('is idempotent — re-issuing for the same appointment returns the existing token, not a new one', async () => {
      const { service } = makeService();
      const first = await service.generateToken(CLINIC, 'appt-1', 'user-fd');
      const second = await service.generateToken(CLINIC, 'appt-1', 'user-fd');
      expect(second.id).toBe(first.id);
      expect(second.tokenNumber).toBe(first.tokenNumber);
    });

    it('transitions a CHECKED_IN appointment to WAITING via AppointmentsService (never writes Appointment.status itself)', async () => {
      const { service, appointmentsService } = makeService();
      (appointmentsService.getAppointmentRow as jest.Mock).mockResolvedValue(
        makeAppointment({ status: 'CHECKED_IN' }),
      );

      await service.generateToken(CLINIC, 'appt-1', 'user-fd');
      expect(appointmentsService.waiting).toHaveBeenCalledWith(CLINIC, 'appt-1', 'user-fd');
    });

    it('rejects issuing a token for an appointment not CHECKED_IN/WAITING', async () => {
      const { service, appointmentsService } = makeService();
      (appointmentsService.getAppointmentRow as jest.Mock).mockResolvedValue(
        makeAppointment({ status: 'SCHEDULED' }),
      );

      await expect(service.generateToken(CLINIC, 'appt-1', 'user-fd')).rejects.toThrow(
        ConflictException,
      );
    });

    it('404s for an appointment that does not exist in this clinic', async () => {
      const { service, appointmentsService } = makeService();
      (appointmentsService.getAppointmentRow as jest.Mock).mockResolvedValue(null);

      await expect(service.generateToken(CLINIC, 'appt-1', 'user-fd')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('concurrency: token generation', () => {
    it('two receptionists generating tokens for two different appointments at the same moment never receive the same token number', async () => {
      const { service, appointmentsService } = makeService();
      (appointmentsService.getAppointmentRow as jest.Mock).mockImplementation(
        (_clinicId: string, appointmentId: string) =>
          Promise.resolve(makeAppointment({ id: appointmentId })),
      );

      const [a, b] = await Promise.all([
        service.generateToken(CLINIC, 'appt-1', 'user-fd-1'),
        service.generateToken(CLINIC, 'appt-2', 'user-fd-2'),
      ]);

      expect(new Set([a.tokenNumber, b.tokenNumber])).toEqual(new Set([1, 2]));
      expect(a.appointmentId).not.toBe(b.appointmentId);
    });

    it('double-clicking "generate token" for the same appointment concurrently yields exactly one token', async () => {
      const { service, entries } = makeService();

      const [a, b] = await Promise.all([
        service.generateToken(CLINIC, 'appt-1', 'user-fd'),
        service.generateToken(CLINIC, 'appt-1', 'user-fd'),
      ]);

      expect(a.tokenNumber).toBe(b.tokenNumber);
      expect(a.id).toBe(b.id);
      expect([...entries.values()].filter((e) => e.appointmentId === 'appt-1')).toHaveLength(1);
    });
  });

  describe('call-next', () => {
    it('claims the earliest-token WAITING entry and starts the consultation', async () => {
      const { service, entries, appointmentsService } = makeService();
      seedEntry(entries, { id: 'qe-2', appointmentId: 'appt-2', tokenNumber: 2 });
      seedEntry(entries, { id: 'qe-1', appointmentId: 'appt-1', tokenNumber: 1 });

      const result = await service.callNext(CLINIC, DOCTOR_1, 'user-doc');
      expect(result.appointmentId).toBe('appt-1');
      expect(result.status).toBe('IN_CONSULTATION');
      expect(appointmentsService.start).toHaveBeenCalledWith(CLINIC, 'appt-1', 'user-doc', {
        doctorId: DOCTOR_1,
      });
    });

    it('throws NotFoundException when nobody is waiting', async () => {
      const { service } = makeService();
      await expect(service.callNext(CLINIC, DOCTOR_1, 'user-doc')).rejects.toThrow(
        NotFoundException,
      );
    });

    it("never claims another doctor's WAITING entry", async () => {
      const { service, entries } = makeService();
      seedEntry(entries, {
        id: 'qe-1',
        appointmentId: 'appt-1',
        tokenNumber: 1,
        doctorId: DOCTOR_2,
      });

      await expect(service.callNext(CLINIC, DOCTOR_1, 'user-doc')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('reverts the queue entry to CALLED (not WAITING — it was already announced) if the Appointment-side transition fails', async () => {
      const { service, entries, appointmentsService } = makeService();
      seedEntry(entries, { id: 'qe-1', appointmentId: 'appt-1', tokenNumber: 1 });
      (appointmentsService.start as jest.Mock).mockRejectedValue(new ConflictException('boom'));

      await expect(service.callNext(CLINIC, DOCTOR_1, 'user-doc')).rejects.toThrow('boom');
      expect(entries.get('qe-1')?.status).toBe('CALLED');
    });
  });

  describe('concurrency: call-next', () => {
    it('two doctors/receptionists calling next at the same moment never receive the same patient', async () => {
      const { service, entries } = makeService();
      seedEntry(entries, { id: 'qe-1', appointmentId: 'appt-1', tokenNumber: 1 });
      seedEntry(entries, { id: 'qe-2', appointmentId: 'appt-2', tokenNumber: 2 });

      const [a, b] = await Promise.all([
        service.callNext(CLINIC, DOCTOR_1, 'user-doc-a'),
        service.callNext(CLINIC, DOCTOR_1, 'user-doc-b'),
      ]);

      expect(new Set([a.appointmentId, b.appointmentId])).toEqual(new Set(['appt-1', 'appt-2']));
    });

    it('two concurrent call-next calls against a single WAITING patient: exactly one wins, the other 404s', async () => {
      const { service, entries } = makeService();
      seedEntry(entries, { id: 'qe-1', appointmentId: 'appt-1', tokenNumber: 1 });

      const results = await Promise.allSettled([
        service.callNext(CLINIC, DOCTOR_1, 'user-doc-a'),
        service.callNext(CLINIC, DOCTOR_1, 'user-doc-b'),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(NotFoundException);
    });
  });

  describe('recall', () => {
    it('re-pings a CALLED entry (bumps calledCount, stays CALLED)', async () => {
      const { service, entries } = makeService();
      seedEntry(entries, {
        id: 'qe-1',
        appointmentId: 'appt-1',
        tokenNumber: 1,
        status: 'CALLED',
        calledCount: 1,
      });

      const result = await service.recall(CLINIC, 'appt-1', 'user-fd');
      expect(result.status).toBe('CALLED');
      expect(result.calledCount).toBe(2);
    });

    it('requeues a SKIPPED entry at the back of the line with a fresh token', async () => {
      const { service, entries } = makeService();
      seedEntry(entries, {
        id: 'qe-1',
        appointmentId: 'appt-1',
        tokenNumber: 1,
        status: 'WAITING',
      });
      seedEntry(entries, {
        id: 'qe-2',
        appointmentId: 'appt-2',
        tokenNumber: 2,
        status: 'SKIPPED',
        skippedAt: new Date(),
      });

      const result = await service.recall(CLINIC, 'appt-2', 'user-fd');
      expect(result.status).toBe('WAITING');
      expect(result.tokenNumber).toBe(3);
    });

    it('rejects recalling a WAITING or COMPLETED entry', async () => {
      const { service, entries } = makeService();
      seedEntry(entries, {
        id: 'qe-1',
        appointmentId: 'appt-1',
        tokenNumber: 1,
        status: 'WAITING',
      });

      await expect(service.recall(CLINIC, 'appt-1', 'user-fd')).rejects.toThrow(ConflictException);
    });

    it('enforces doctor ownership when a scope is given', async () => {
      const { service, entries } = makeService();
      seedEntry(entries, {
        id: 'qe-1',
        appointmentId: 'appt-1',
        tokenNumber: 1,
        status: 'CALLED',
        doctorId: DOCTOR_1,
      });

      await expect(
        service.recall(CLINIC, 'appt-1', 'user-doc', { doctorId: DOCTOR_2 }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('skip', () => {
    it('skips a WAITING entry', async () => {
      const { service, entries } = makeService();
      seedEntry(entries, { id: 'qe-1', appointmentId: 'appt-1', tokenNumber: 1 });

      const result = await service.skip(CLINIC, 'appt-1', 'user-fd');
      expect(result.status).toBe('SKIPPED');
    });

    it('rejects skipping an already-COMPLETED entry', async () => {
      const { service, entries } = makeService();
      seedEntry(entries, {
        id: 'qe-1',
        appointmentId: 'appt-1',
        tokenNumber: 1,
        status: 'COMPLETED',
      });

      await expect(service.skip(CLINIC, 'appt-1', 'user-fd')).rejects.toThrow(ConflictException);
    });
  });

  describe('startConsultation', () => {
    it('starts directly from WAITING (skipping an explicit "called" step)', async () => {
      const { service, entries, appointmentsService } = makeService();
      seedEntry(entries, { id: 'qe-1', appointmentId: 'appt-1', tokenNumber: 1 });

      const result = await service.startConsultation(CLINIC, 'appt-1', 'user-doc');
      expect(result.status).toBe('IN_CONSULTATION');
      expect(appointmentsService.start).toHaveBeenCalledWith(
        CLINIC,
        'appt-1',
        'user-doc',
        undefined,
      );
    });

    it('starts from CALLED', async () => {
      const { service, entries } = makeService();
      seedEntry(entries, {
        id: 'qe-1',
        appointmentId: 'appt-1',
        tokenNumber: 1,
        status: 'CALLED',
      });

      const result = await service.startConsultation(CLINIC, 'appt-1', 'user-doc');
      expect(result.status).toBe('IN_CONSULTATION');
    });

    it('rejects starting an already-COMPLETED entry', async () => {
      const { service, entries } = makeService();
      seedEntry(entries, {
        id: 'qe-1',
        appointmentId: 'appt-1',
        tokenNumber: 1,
        status: 'COMPLETED',
      });

      await expect(service.startConsultation(CLINIC, 'appt-1', 'user-doc')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('completeConsultation', () => {
    it('completes an IN_CONSULTATION entry and delegates to AppointmentsService.complete', async () => {
      const { service, entries, appointmentsService } = makeService();
      seedEntry(entries, {
        id: 'qe-1',
        appointmentId: 'appt-1',
        tokenNumber: 1,
        status: 'IN_CONSULTATION',
      });

      const result = await service.completeConsultation(CLINIC, 'appt-1', 'user-doc');
      expect(result.status).toBe('COMPLETED');
      expect(appointmentsService.complete).toHaveBeenCalledWith(
        CLINIC,
        'appt-1',
        'user-doc',
        undefined,
      );
    });

    it('reverts to IN_CONSULTATION if the Appointment-side complete() fails', async () => {
      const { service, entries, appointmentsService } = makeService();
      seedEntry(entries, {
        id: 'qe-1',
        appointmentId: 'appt-1',
        tokenNumber: 1,
        status: 'IN_CONSULTATION',
      });
      (appointmentsService.complete as jest.Mock).mockRejectedValue(new ConflictException('boom'));

      await expect(service.completeConsultation(CLINIC, 'appt-1', 'user-doc')).rejects.toThrow(
        'boom',
      );
      expect(entries.get('qe-1')?.status).toBe('IN_CONSULTATION');
    });

    it('rejects completing a WAITING entry', async () => {
      const { service, entries } = makeService();
      seedEntry(entries, { id: 'qe-1', appointmentId: 'appt-1', tokenNumber: 1 });

      await expect(service.completeConsultation(CLINIC, 'appt-1', 'user-doc')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('markNoShow', () => {
    it('marks a WAITING entry NO_SHOW and delegates to AppointmentsService.noShow', async () => {
      const { service, entries, appointmentsService } = makeService();
      seedEntry(entries, { id: 'qe-1', appointmentId: 'appt-1', tokenNumber: 1 });

      const result = await service.markNoShow(CLINIC, 'appt-1', 'user-fd');
      expect(result.status).toBe('NO_SHOW');
      expect(appointmentsService.noShow).toHaveBeenCalledWith(CLINIC, 'appt-1', 'user-fd');
    });

    it('reverts to the prior status if the Appointment-side no-show fails', async () => {
      const { service, entries, appointmentsService } = makeService();
      seedEntry(entries, {
        id: 'qe-1',
        appointmentId: 'appt-1',
        tokenNumber: 1,
        status: 'CALLED',
      });
      (appointmentsService.noShow as jest.Mock).mockRejectedValue(new ConflictException('boom'));

      await expect(service.markNoShow(CLINIC, 'appt-1', 'user-fd')).rejects.toThrow('boom');
      expect(entries.get('qe-1')?.status).toBe('CALLED');
    });

    it('rejects marking an already-COMPLETED entry as no-show', async () => {
      const { service, entries } = makeService();
      seedEntry(entries, {
        id: 'qe-1',
        appointmentId: 'appt-1',
        tokenNumber: 1,
        status: 'COMPLETED',
      });

      await expect(service.markNoShow(CLINIC, 'appt-1', 'user-fd')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('today’s queue listing / position', () => {
    it('assigns sequential positions to WAITING entries by token order, and null once past WAITING', async () => {
      const { service, entries } = makeService();
      seedEntry(entries, { id: 'qe-1', appointmentId: 'appt-1', tokenNumber: 1, status: 'CALLED' });
      seedEntry(entries, {
        id: 'qe-2',
        appointmentId: 'appt-2',
        tokenNumber: 2,
        status: 'WAITING',
      });
      seedEntry(entries, {
        id: 'qe-3',
        appointmentId: 'appt-3',
        tokenNumber: 3,
        status: 'WAITING',
      });

      const queue = await service.findClinicQueue(CLINIC);
      const byId = new Map(queue.map((e) => [e.appointmentId, e]));
      expect(byId.get('appt-1')?.position).toBeNull();
      expect(byId.get('appt-2')?.position).toBe(1);
      expect(byId.get('appt-3')?.position).toBe(2);
    });

    it('findOwnQueue scopes to a single doctor', async () => {
      const { service, entries } = makeService();
      seedEntry(entries, {
        id: 'qe-1',
        appointmentId: 'appt-1',
        tokenNumber: 1,
        doctorId: DOCTOR_1,
      });
      seedEntry(entries, {
        id: 'qe-2',
        appointmentId: 'appt-2',
        tokenNumber: 1,
        doctorId: DOCTOR_2,
      });

      const queue = await service.findOwnQueue(CLINIC, DOCTOR_1);
      expect(queue).toHaveLength(1);
      expect(queue[0].doctorId).toBe(DOCTOR_1);
    });
  });
});
