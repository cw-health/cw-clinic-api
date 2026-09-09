import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import type { JwtPayload } from '../src/auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Exercises the queue module end to end: generate token, GET /queue,
 * GET /queue/me, call-next, recall, skip, start, complete, no-show,
 * authorization, and tenant isolation. Queue owns its own `QueueEntry`
 * rows but every operation that changes the underlying appointment's
 * lifecycle still delegates to `AppointmentsService` (see
 * queue.service.ts's module doc comment / docs/DECISIONS.md) — this
 * harness fakes both tables so that delegation is exercised for real,
 * not stubbed out.
 */
function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });
}

const CLINIC_A = 'clinic-a';
const CLINIC_B = 'clinic-b';
const DOCTOR_1 = '11111111-1111-4111-8111-111111111111';
const DOCTOR_2 = '22222222-2222-4222-8222-222222222222';
const PATIENT_1 = '33333333-3333-4333-8333-333333333333';
const PATIENT_2 = '44444444-4444-4444-8444-444444444444';
const APPT_1 = '55555555-5555-4555-8555-555555555555';
const APPT_2 = '66666666-6666-4666-8666-666666666666';

const frontDeskPayload: JwtPayload = {
  sub: 'user-fd-1',
  email: 'fd1@clinic-a.test',
  role: 'FrontDesk',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['queue:manage'],
};

const doctorPayload: JwtPayload = {
  sub: 'user-doc-1',
  email: 'doc1@clinic-a.test',
  role: 'Doctor',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['queue:manage-own'],
};

const otherDoctorPayload: JwtPayload = {
  sub: 'user-doc-2',
  email: 'doc2@clinic-a.test',
  role: 'Doctor',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['queue:manage-own'],
};

const adminBPayload: JwtPayload = {
  sub: 'user-admin-b',
  email: 'admin@clinic-b.test',
  role: 'FrontDesk',
  clinicId: CLINIC_B,
  clinicName: 'Clinic B',
  isSuperAdmin: false,
  permissions: ['queue:manage'],
};

const noPermissionPayload: JwtPayload = {
  sub: 'user-none',
  email: 'none@clinic-a.test',
  role: 'FrontDesk',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: [],
};

interface AppointmentRow {
  id: string;
  clinicId: string;
  doctorId: string;
  patientId: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  reasonForVisit: string | null;
  notes: string | null;
  createdByUserId: string;
  confirmedAt: Date | null;
  checkedInAt: Date | null;
  consultationStartedAt: Date | null;
  completedAt: Date | null;
  noShowAt: Date | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface QueueEntryRow {
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

function matches<T extends object>(row: T, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    const value = (row as unknown as Record<string, unknown>)[key];
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const cond = condition as Record<string, unknown>;
      if ('not' in cond && value === cond.not) return false;
      if ('lt' in cond && !((value as Date) < (cond.lt as Date))) return false;
      if ('gt' in cond && !((value as Date) > (cond.gt as Date))) return false;
      if ('gte' in cond && !((value as Date) >= (cond.gte as Date))) return false;
      if ('in' in cond && !(cond.in as unknown[]).includes(value)) return false;
    } else {
      // Plain equality — normalize Dates to their timestamp, since two
      // `Date` instances for the same instant (e.g. QueueEntry.queueDate,
      // recomputed fresh on every clinicDayRange() call) are never `===`
      // by reference.
      const ev = value instanceof Date ? +value : value;
      const cv = condition instanceof Date ? +condition : condition;
      if (ev !== cv) return false;
    }
  }
  return true;
}

function applyOrder<T>(list: T[], orderBy?: Record<string, 'asc' | 'desc'>): T[] {
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

function makeFakePrisma() {
  const clinics = new Map<string, { id: string; timezone: string }>();
  clinics.set(CLINIC_A, { id: CLINIC_A, timezone: 'UTC' });
  clinics.set(CLINIC_B, { id: CLINIC_B, timezone: 'UTC' });

  const doctors = new Map<
    string,
    {
      id: string;
      clinicId: string;
      userId: string;
      deletedAt: null;
      status: string;
      user: unknown;
      specializations: never[];
      departments: never[];
    }
  >();
  doctors.set(DOCTOR_1, {
    id: DOCTOR_1,
    clinicId: CLINIC_A,
    userId: doctorPayload.sub,
    deletedAt: null,
    status: 'ACTIVE',
    user: {
      id: doctorPayload.sub,
      email: doctorPayload.email,
      firstName: 'Ada',
      lastName: 'Lovelace',
    },
    specializations: [],
    departments: [],
  });
  doctors.set(DOCTOR_2, {
    id: DOCTOR_2,
    clinicId: CLINIC_A,
    userId: otherDoctorPayload.sub,
    deletedAt: null,
    status: 'ACTIVE',
    user: {
      id: otherDoctorPayload.sub,
      email: otherDoctorPayload.email,
      firstName: 'Grace',
      lastName: 'Hopper',
    },
    specializations: [],
    departments: [],
  });

  const patients = new Map<
    string,
    { id: string; clinicId: string; firstName: string; lastName: string }
  >();
  patients.set(PATIENT_1, {
    id: PATIENT_1,
    clinicId: CLINIC_A,
    firstName: 'Mary',
    lastName: 'Jackson',
  });
  patients.set(PATIENT_2, {
    id: PATIENT_2,
    clinicId: CLINIC_A,
    firstName: 'Katherine',
    lastName: 'Johnson',
  });

  const appointments = new Map<string, AppointmentRow>();
  const queueEntries = new Map<string, QueueEntryRow>();
  let queueSeq = 0;
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  function seedAppointment(id: string, doctorId: string, patientId: string, status: string): void {
    appointments.set(id, {
      id,
      clinicId: CLINIC_A,
      doctorId,
      patientId,
      startsAt: now,
      endsAt: new Date(now.getTime() + 30 * 60_000),
      status,
      reasonForVisit: null,
      notes: null,
      createdByUserId: 'user-staff',
      confirmedAt: now,
      checkedInAt: now,
      consultationStartedAt: null,
      completedAt: null,
      noShowAt: null,
      cancelledAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  const fakePrisma = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    isHealthy: jest.fn().mockResolvedValue(true),
    auditLog: {
      create: jest.fn().mockResolvedValue(undefined),
    },
    clinic: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(clinics.get(where.id) ?? null),
      ),
    },
    doctor: {
      findFirst: jest.fn(
        ({ where }: { where: { id?: string; userId?: string; clinicId: string } }) => {
          const doctor = where.id
            ? doctors.get(where.id)
            : [...doctors.values()].find((d) => d.userId === where.userId);
          if (!doctor || doctor.clinicId !== where.clinicId) return Promise.resolve(null);
          return Promise.resolve(doctor);
        },
      ),
    },
    patient: {
      findFirst: jest.fn(({ where }: { where: { id?: string; clinicId: string } }) => {
        const patient = where.id ? patients.get(where.id) : undefined;
        if (!patient || patient.clinicId !== where.clinicId) return Promise.resolve(null);
        return Promise.resolve(patient);
      }),
    },
    appointment: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const found = [...appointments.values()].find((a) => matches(a, where));
        return Promise.resolve(found ?? null);
      }),
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const all = [...appointments.values()].filter((a) => matches(a, where));
        return Promise.resolve(all);
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = appointments.get(where.id)!;
          Object.assign(row, data, { updatedAt: new Date() });
          return Promise.resolve(row);
        },
      ),
      updateMany: jest.fn(
        ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const rows = [...appointments.values()].filter((a) => matches(a, where));
          for (const row of rows) Object.assign(row, data, { updatedAt: new Date() });
          return Promise.resolve({ count: rows.length });
        },
      ),
    },
    queueEntry: {
      findUnique: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const found = [...queueEntries.values()].find((e) => matches(e, where));
        return Promise.resolve(found ?? null);
      }),
      findUniqueOrThrow: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const found = [...queueEntries.values()].find((e) => matches(e, where));
        if (!found) return Promise.reject(new Error('QueueEntry not found'));
        return Promise.resolve(found);
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
            [...queueEntries.values()].filter((e) => matches(e, where)),
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
            [...queueEntries.values()].filter((e) => matches(e, where)),
            orderBy,
          );
          return Promise.resolve(list);
        },
      ),
      count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve([...queueEntries.values()].filter((e) => matches(e, where)).length),
      ),
      create: jest.fn(({ data }: { data: Partial<QueueEntryRow> }) => {
        const id = `qe-${++queueSeq}`;
        const entry: QueueEntryRow = {
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
        } as QueueEntryRow;
        const clash = [...queueEntries.values()].some(
          (e) =>
            (e.clinicId === entry.clinicId &&
              e.doctorId === entry.doctorId &&
              +e.queueDate === +entry.queueDate &&
              e.tokenNumber === entry.tokenNumber) ||
            e.appointmentId === entry.appointmentId,
        );
        if (clash) throw uniqueViolation();
        queueEntries.set(id, entry);
        return Promise.resolve(entry);
      }),
      updateMany: jest.fn(
        ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const rows = [...queueEntries.values()].filter((e) => matches(e, where));
          for (const row of rows) {
            for (const [key, value] of Object.entries(data)) {
              if (value && typeof value === 'object' && 'increment' in value) {
                (row as unknown as Record<string, number>)[key] =
                  ((row as unknown as Record<string, number>)[key] ?? 0) +
                  (value as { increment: number }).increment;
              } else {
                (row as unknown as Record<string, unknown>)[key] = value;
              }
            }
            row.updatedAt = new Date();
          }
          return Promise.resolve({ count: rows.length });
        },
      ),
    },
  };

  (fakePrisma as Record<string, unknown>).$transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(fakePrisma);
  });

  return { fakePrisma, seedAppointment, appointments, queueEntries, dayStart };
}

describe('Queue (e2e) — token generation, live view, call-next/recall/skip/start/complete/no-show', () => {
  let app: INestApplication;
  let harness: ReturnType<typeof makeFakePrisma>;

  beforeAll(async () => {
    harness = makeFakePrisma();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(harness.fakePrisma)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer() as Server;
  const auth = (payload: JwtPayload) => `Bearer ${signToken(payload)}`;

  beforeEach(() => {
    harness.appointments.clear();
    harness.queueEntries.clear();
  });

  describe('authorization', () => {
    it('rejects with no token', async () => {
      const res = await request(server()).get('/api/v1/queue');
      expect(res.status).toBe(401);
    });

    it('rejects a role without queue:manage', async () => {
      const res = await request(server())
        .get('/api/v1/queue')
        .set('Authorization', auth(noPermissionPayload));
      expect(res.status).toBe(403);
    });

    it('rejects /queue/me for a caller with no Doctor profile', async () => {
      const res = await request(server())
        .get('/api/v1/queue/me')
        .set('Authorization', auth(frontDeskPayload));
      expect(res.status).toBe(403);
    });
  });

  describe('POST /queue — generate token', () => {
    it('issues token 1 for a checked-in appointment and transitions it to WAITING', async () => {
      harness.seedAppointment(APPT_1, DOCTOR_1, PATIENT_1, 'CHECKED_IN');

      const res = await request(server())
        .post('/api/v1/queue')
        .set('Authorization', auth(frontDeskPayload))
        .send({ appointmentId: APPT_1 });

      expect(res.status).toBe(201);
      const body = res.body as { tokenNumber: number; status: string; appointmentStatus: string };
      expect(body.tokenNumber).toBe(1);
      expect(body.status).toBe('WAITING');
      expect(body.appointmentStatus).toBe('WAITING');
      expect(harness.appointments.get(APPT_1)?.status).toBe('WAITING');
    });

    it('is idempotent on double submission', async () => {
      harness.seedAppointment(APPT_1, DOCTOR_1, PATIENT_1, 'WAITING');

      const first = await request(server())
        .post('/api/v1/queue')
        .set('Authorization', auth(frontDeskPayload))
        .send({ appointmentId: APPT_1 });
      const second = await request(server())
        .post('/api/v1/queue')
        .set('Authorization', auth(frontDeskPayload))
        .send({ appointmentId: APPT_1 });

      expect((first.body as { id: string }).id).toBe((second.body as { id: string }).id);
    });

    it('rejects issuing a token for a SCHEDULED (not yet checked in) appointment', async () => {
      harness.seedAppointment(APPT_1, DOCTOR_1, PATIENT_1, 'SCHEDULED');

      const res = await request(server())
        .post('/api/v1/queue')
        .set('Authorization', auth(frontDeskPayload))
        .send({ appointmentId: APPT_1 });
      expect(res.status).toBe(409);
    });
  });

  describe('GET /queue', () => {
    it("lists today's queue with token/position", async () => {
      harness.seedAppointment(APPT_1, DOCTOR_1, PATIENT_1, 'WAITING');
      harness.queueEntries.set('qe-1', {
        id: 'qe-1',
        clinicId: CLINIC_A,
        doctorId: DOCTOR_1,
        appointmentId: APPT_1,
        queueDate: harness.dayStart,
        tokenNumber: 1,
        status: 'WAITING',
        calledAt: null,
        calledCount: 0,
        consultationStartedAt: null,
        completedAt: null,
        skippedAt: null,
        noShowAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(server())
        .get('/api/v1/queue')
        .set('Authorization', auth(frontDeskPayload));
      expect(res.status).toBe(200);
      const body = res.body as { appointmentId: string; tokenNumber: number; position: number }[];
      expect(body).toHaveLength(1);
      expect(body[0].tokenNumber).toBe(1);
      expect(body[0].position).toBe(1);
    });

    it('tenant isolation: clinic B sees an empty queue while clinic A has one', async () => {
      harness.seedAppointment(APPT_1, DOCTOR_1, PATIENT_1, 'WAITING');
      harness.queueEntries.set('qe-1', {
        id: 'qe-1',
        clinicId: CLINIC_A,
        doctorId: DOCTOR_1,
        appointmentId: APPT_1,
        queueDate: harness.dayStart,
        tokenNumber: 1,
        status: 'WAITING',
        calledAt: null,
        calledCount: 0,
        consultationStartedAt: null,
        completedAt: null,
        skippedAt: null,
        noShowAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(server())
        .get('/api/v1/queue')
        .set('Authorization', auth(adminBPayload));
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('POST /queue/call-next', () => {
    async function issueToken(appointmentId: string, doctorId: string, patientId: string) {
      harness.seedAppointment(appointmentId, doctorId, patientId, 'CHECKED_IN');
      await request(server())
        .post('/api/v1/queue')
        .set('Authorization', auth(frontDeskPayload))
        .send({ appointmentId });
    }

    it("calls and starts the doctor's earliest WAITING token", async () => {
      await issueToken(APPT_1, DOCTOR_1, PATIENT_1);

      const res = await request(server())
        .post('/api/v1/queue/call-next')
        .set('Authorization', auth(doctorPayload));
      expect(res.status).toBe(201);
      const body = res.body as { status: string; appointmentStatus: string; appointmentId: string };
      expect(body.status).toBe('IN_CONSULTATION');
      expect(body.appointmentStatus).toBe('IN_CONSULTATION');
      expect(body.appointmentId).toBe(APPT_1);
    });

    it("a doctor cannot call a patient from another doctor's queue", async () => {
      await issueToken(APPT_1, DOCTOR_2, PATIENT_2);

      const res = await request(server())
        .post('/api/v1/queue/call-next')
        .set('Authorization', auth(doctorPayload));
      expect(res.status).toBe(404);
    });

    it('two sequential call-next calls do not double-assign the same appointment', async () => {
      await issueToken(APPT_1, DOCTOR_1, PATIENT_1);

      const first = await request(server())
        .post('/api/v1/queue/call-next')
        .set('Authorization', auth(doctorPayload));
      expect(first.status).toBe(201);

      const second = await request(server())
        .post('/api/v1/queue/call-next')
        .set('Authorization', auth(doctorPayload));
      expect(second.status).toBe(404);
    });

    it('two concurrent call-next requests never receive the same patient', async () => {
      await issueToken(APPT_1, DOCTOR_1, PATIENT_1);
      harness.seedAppointment(APPT_2, DOCTOR_1, PATIENT_2, 'CHECKED_IN');
      await request(server())
        .post('/api/v1/queue')
        .set('Authorization', auth(frontDeskPayload))
        .send({ appointmentId: APPT_2 });

      const [a, b] = await Promise.all([
        request(server()).post('/api/v1/queue/call-next').set('Authorization', auth(doctorPayload)),
        request(server()).post('/api/v1/queue/call-next').set('Authorization', auth(doctorPayload)),
      ]);
      const ids = [a.body as { appointmentId: string }, b.body as { appointmentId: string }].map(
        (b) => b.appointmentId,
      );
      expect(new Set(ids)).toEqual(new Set([APPT_1, APPT_2]));
    });
  });

  describe('recall / skip / start / complete / no-show', () => {
    function seedQueueEntry(overrides: Partial<QueueEntryRow> & { appointmentId: string }) {
      const id = overrides.id ?? `qe-${overrides.appointmentId}`;
      harness.queueEntries.set(id, {
        id,
        clinicId: CLINIC_A,
        doctorId: DOCTOR_1,
        tokenNumber: 1,
        status: 'WAITING',
        calledAt: null,
        calledCount: 0,
        consultationStartedAt: null,
        completedAt: null,
        skippedAt: null,
        noShowAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        queueDate: harness.dayStart,
        ...overrides,
      });
    }

    it('skips a WAITING token (front desk only)', async () => {
      harness.seedAppointment(APPT_1, DOCTOR_1, PATIENT_1, 'WAITING');
      seedQueueEntry({ appointmentId: APPT_1 });

      const res = await request(server())
        .post(`/api/v1/queue/${APPT_1}/skip`)
        .set('Authorization', auth(frontDeskPayload));
      expect(res.status).toBe(201);
      expect((res.body as { status: string }).status).toBe('SKIPPED');
    });

    it('a doctor cannot skip (staff-only action)', async () => {
      harness.seedAppointment(APPT_1, DOCTOR_1, PATIENT_1, 'WAITING');
      seedQueueEntry({ appointmentId: APPT_1 });

      const res = await request(server())
        .post(`/api/v1/queue/${APPT_1}/skip`)
        .set('Authorization', auth(doctorPayload));
      expect(res.status).toBe(403);
    });

    it('recalls a CALLED token (re-announce)', async () => {
      harness.seedAppointment(APPT_1, DOCTOR_1, PATIENT_1, 'WAITING');
      seedQueueEntry({ appointmentId: APPT_1, status: 'CALLED', calledCount: 1 });

      const res = await request(server())
        .post(`/api/v1/queue/${APPT_1}/recall`)
        .set('Authorization', auth(doctorPayload));
      expect(res.status).toBe(201);
      const body = res.body as { status: string; calledCount: number };
      expect(body.status).toBe('CALLED');
      expect(body.calledCount).toBe(2);
    });

    it("a doctor cannot recall another doctor's token", async () => {
      harness.seedAppointment(APPT_1, DOCTOR_2, PATIENT_2, 'WAITING');
      seedQueueEntry({ appointmentId: APPT_1, doctorId: DOCTOR_2, status: 'CALLED' });

      const res = await request(server())
        .post(`/api/v1/queue/${APPT_1}/recall`)
        .set('Authorization', auth(doctorPayload));
      expect(res.status).toBe(403);
    });

    it('marks consultation started explicitly, from WAITING', async () => {
      harness.seedAppointment(APPT_1, DOCTOR_1, PATIENT_1, 'WAITING');
      seedQueueEntry({ appointmentId: APPT_1 });

      const res = await request(server())
        .post(`/api/v1/queue/${APPT_1}/start`)
        .set('Authorization', auth(doctorPayload));
      expect(res.status).toBe(201);
      expect((res.body as { status: string }).status).toBe('IN_CONSULTATION');
      expect(harness.appointments.get(APPT_1)?.status).toBe('IN_CONSULTATION');
    });

    it('marks completed', async () => {
      harness.seedAppointment(APPT_1, DOCTOR_1, PATIENT_1, 'IN_CONSULTATION');
      seedQueueEntry({ appointmentId: APPT_1, status: 'IN_CONSULTATION' });

      const res = await request(server())
        .post(`/api/v1/queue/${APPT_1}/complete`)
        .set('Authorization', auth(doctorPayload));
      expect(res.status).toBe(201);
      expect((res.body as { status: string }).status).toBe('COMPLETED');
      expect(harness.appointments.get(APPT_1)?.status).toBe('COMPLETED');
    });

    it('marks no-show (front desk only) and mirrors it onto the Appointment', async () => {
      harness.seedAppointment(APPT_1, DOCTOR_1, PATIENT_1, 'WAITING');
      seedQueueEntry({ appointmentId: APPT_1 });

      const res = await request(server())
        .post(`/api/v1/queue/${APPT_1}/no-show`)
        .set('Authorization', auth(frontDeskPayload));
      expect(res.status).toBe(201);
      expect((res.body as { status: string }).status).toBe('NO_SHOW');
      expect(harness.appointments.get(APPT_1)?.status).toBe('NO_SHOW');
    });
  });
});
