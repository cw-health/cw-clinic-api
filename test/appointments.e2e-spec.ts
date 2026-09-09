import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import type { JwtPayload } from '../src/auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Exercises the real AuthGuard -> TenantGuard -> PermissionsGuard chain,
 * the appointments status state machine, double-booking prevention, and
 * ownership scoping end to end over HTTP — mirrors test/doctors.e2e-spec.ts
 * (fully mocked in-memory PrismaService, JWTs signed directly since
 * JwtStrategy only decodes, no DB round trip).
 */
function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });
}

const CLINIC_A = 'clinic-a';
const CLINIC_B = 'clinic-b';

const adminAPayload: JwtPayload = {
  sub: 'user-admin-a',
  email: 'admin@clinic-a.test',
  role: 'ClinicAdmin',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: [
    'appointments:create',
    'appointments:read',
    'appointments:update',
    'appointments:cancel',
    'appointments:reschedule',
    'appointments:confirm',
    'appointments:update-status',
  ],
};

const adminBPayload: JwtPayload = {
  ...adminAPayload,
  sub: 'user-admin-b',
  email: 'admin@clinic-b.test',
  clinicId: CLINIC_B,
  clinicName: 'Clinic B',
};

const doctorPayload: JwtPayload = {
  sub: 'user-doc-1',
  email: 'doc1@clinic-a.test',
  role: 'Doctor',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['appointments:read', 'appointments:update-status'],
};

const otherDoctorPayload: JwtPayload = {
  sub: 'user-doc-2',
  email: 'doc2@clinic-a.test',
  role: 'Doctor',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['appointments:read', 'appointments:update-status'],
};

const patientPayload: JwtPayload = {
  sub: 'user-patient-1',
  email: 'patient1@clinic-a.test',
  role: 'Patient',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: [
    'appointments:create-own',
    'appointments:read-own',
    'appointments:cancel-own',
    'appointments:reschedule-own',
  ],
};

const frontDeskNoAppointmentsPayload: JwtPayload = {
  sub: 'user-fd-1',
  email: 'fd1@clinic-a.test',
  role: 'FrontDesk',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['patients:create', 'patients:read'],
};

interface DoctorRow {
  id: string;
  clinicId: string;
  userId: string;
  deletedAt: Date | null;
  appointmentDurationMinutes: number | null;
  status: string;
  user: { id: string; email: string; firstName: string; lastName: string };
  specializations: never[];
}

interface PatientRow {
  id: string;
  clinicId: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  mrn: string;
  deletedAt: Date | null;
  status: string;
}

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

function makeFakePrisma() {
  const doctors = new Map<string, DoctorRow>();
  doctors.set('11111111-1111-4111-8111-111111111111', {
    id: '11111111-1111-4111-8111-111111111111',
    clinicId: CLINIC_A,
    userId: doctorPayload.sub,
    deletedAt: null,
    appointmentDurationMinutes: null,
    status: 'ACTIVE',
    user: {
      id: doctorPayload.sub,
      email: doctorPayload.email,
      firstName: 'Ada',
      lastName: 'Lovelace',
    },
    specializations: [],
  });
  doctors.set('22222222-2222-4222-8222-222222222222', {
    id: '22222222-2222-4222-8222-222222222222',
    clinicId: CLINIC_A,
    userId: otherDoctorPayload.sub,
    deletedAt: null,
    appointmentDurationMinutes: null,
    status: 'ACTIVE',
    user: {
      id: otherDoctorPayload.sub,
      email: otherDoctorPayload.email,
      firstName: 'Grace',
      lastName: 'Hopper',
    },
    specializations: [],
  });

  const patients = new Map<string, PatientRow>();
  patients.set('33333333-3333-4333-8333-333333333333', {
    id: '33333333-3333-4333-8333-333333333333',
    clinicId: CLINIC_A,
    userId: patientPayload.sub,
    firstName: 'Mary',
    lastName: 'Jackson',
    mrn: 'MRN-0001',
    deletedAt: null,
    status: 'ACTIVE',
  });
  patients.set('44444444-4444-4444-8444-444444444444', {
    id: '44444444-4444-4444-8444-444444444444',
    clinicId: CLINIC_A,
    userId: null,
    firstName: 'Katherine',
    lastName: 'Johnson',
    mrn: 'MRN-0002',
    deletedAt: null,
    status: 'ACTIVE',
  });

  const appointments = new Map<string, AppointmentRow>();

  function matches(row: AppointmentRow, where: Record<string, unknown>): boolean {
    for (const [key, condition] of Object.entries(where)) {
      const value = (row as unknown as Record<string, unknown>)[key];
      if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
        const cond = condition as Record<string, unknown>;
        if ('not' in cond && value === cond.not) return false;
        if ('lt' in cond && !((value as Date) < (cond.lt as Date))) return false;
        if ('gt' in cond && !((value as Date) > (cond.gt as Date))) return false;
      } else if (value !== condition) {
        return false;
      }
    }
    return true;
  }

  const fakePrisma = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    isHealthy: jest.fn().mockResolvedValue(true),
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
      findFirst: jest.fn(
        ({ where }: { where: { id?: string; userId?: string; clinicId: string } }) => {
          const patient = where.id
            ? patients.get(where.id)
            : [...patients.values()].find((p) => p.userId === where.userId);
          if (!patient || patient.clinicId !== where.clinicId) return Promise.resolve(null);
          return Promise.resolve(patient);
        },
      ),
    },
    appointment: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const found = [...appointments.values()].find((a) => matches(a, where));
        return Promise.resolve(found ?? null);
      }),
      findMany: jest.fn(
        ({
          where,
          skip = 0,
          take = 20,
        }: {
          where: Record<string, unknown>;
          skip?: number;
          take?: number;
        }) => {
          const all = [...appointments.values()]
            .filter((a) => matches(a, where))
            .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
          return Promise.resolve(all.slice(skip, skip + take));
        },
      ),
      count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve([...appointments.values()].filter((a) => matches(a, where)).length),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const row: AppointmentRow = {
          id: randomUUID(),
          clinicId: data.clinicId as string,
          doctorId: data.doctorId as string,
          patientId: data.patientId as string,
          startsAt: data.startsAt as Date,
          endsAt: data.endsAt as Date,
          status: 'SCHEDULED',
          reasonForVisit: (data.reasonForVisit as string) ?? null,
          notes: (data.notes as string) ?? null,
          createdByUserId: data.createdByUserId as string,
          confirmedAt: null,
          checkedInAt: null,
          consultationStartedAt: null,
          completedAt: null,
          noShowAt: null,
          cancelledAt: null,
          cancelledByUserId: null,
          cancellationReason: null,
          createdAt: now,
          updatedAt: now,
        };
        appointments.set(row.id, row);
        return Promise.resolve(row);
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
  };

  (fakePrisma as Record<string, unknown>).$transaction = jest.fn(
    (arg: unknown, _opts?: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
      return (arg as (tx: unknown) => unknown)(fakePrisma);
    },
  );

  return fakePrisma;
}

describe('Appointments (e2e) — state machine, double-booking, ownership, tenant isolation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const fakePrisma = makeFakePrisma();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
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

  const future = (offsetHours: number) => {
    const start = new Date(Date.now() + offsetHours * 3_600_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    return { startsAt: start.toISOString(), endsAt: end.toISOString() };
  };

  describe('authentication & permissions', () => {
    it('rejects with no token', async () => {
      const res = await request(server()).get('/api/v1/appointments');
      expect(res.status).toBe(401);
    });

    it('rejects a role without any appointments permission', async () => {
      const { startsAt, endsAt } = future(1);
      const res = await request(server())
        .post('/api/v1/appointments')
        .set('Authorization', auth(frontDeskNoAppointmentsPayload))
        .send({
          doctorId: '11111111-1111-4111-8111-111111111111',
          patientId: '33333333-3333-4333-8333-333333333333',
          startsAt,
          endsAt,
        });
      expect(res.status).toBe(403);
    });

    it('rejects clinicId being accepted from the client body', async () => {
      const { startsAt, endsAt } = future(2);
      const res = await request(server())
        .post('/api/v1/appointments')
        .set('Authorization', auth(adminAPayload))
        .send({
          doctorId: '11111111-1111-4111-8111-111111111111',
          patientId: '33333333-3333-4333-8333-333333333333',
          startsAt,
          endsAt,
          clinicId: CLINIC_B,
        });
      expect(res.status).toBe(400);
    });
  });

  describe('booking, double-booking prevention', () => {
    it('staff can book an appointment for a patient', async () => {
      const { startsAt, endsAt } = future(3);
      const res = await request(server())
        .post('/api/v1/appointments')
        .set('Authorization', auth(adminAPayload))
        .send({
          doctorId: '11111111-1111-4111-8111-111111111111',
          patientId: '33333333-3333-4333-8333-333333333333',
          startsAt,
          endsAt,
        });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        clinicId: CLINIC_A,
        doctorId: '11111111-1111-4111-8111-111111111111',
        status: 'SCHEDULED',
      });
    });

    it('rejects a second booking for the same doctor in an overlapping window', async () => {
      const { startsAt, endsAt } = future(10);
      await request(server())
        .post('/api/v1/appointments')
        .set('Authorization', auth(adminAPayload))
        .send({
          doctorId: '11111111-1111-4111-8111-111111111111',
          patientId: '33333333-3333-4333-8333-333333333333',
          startsAt,
          endsAt,
        })
        .expect(201);

      const overlapStart = new Date(new Date(startsAt).getTime() + 10 * 60_000).toISOString();
      const overlapEnd = new Date(new Date(endsAt).getTime() + 10 * 60_000).toISOString();
      const res = await request(server())
        .post('/api/v1/appointments')
        .set('Authorization', auth(adminAPayload))
        .send({
          doctorId: '11111111-1111-4111-8111-111111111111',
          patientId: '44444444-4444-4444-8444-444444444444',
          startsAt: overlapStart,
          endsAt: overlapEnd,
        });
      expect(res.status).toBe(409);
    });

    it('rejects a second booking for the same patient in an overlapping window with a different doctor', async () => {
      const { startsAt, endsAt } = future(20);
      await request(server())
        .post('/api/v1/appointments')
        .set('Authorization', auth(adminAPayload))
        .send({
          doctorId: '11111111-1111-4111-8111-111111111111',
          patientId: '33333333-3333-4333-8333-333333333333',
          startsAt,
          endsAt,
        })
        .expect(201);

      const res = await request(server())
        .post('/api/v1/appointments')
        .set('Authorization', auth(adminAPayload))
        .send({
          doctorId: '22222222-2222-4222-8222-222222222222',
          patientId: '33333333-3333-4333-8333-333333333333',
          startsAt,
          endsAt,
        });
      expect(res.status).toBe(409);
    });

    it('a patient can book their own appointment via POST /appointments/me without supplying patientId', async () => {
      const { startsAt, endsAt } = future(30);
      const res = await request(server())
        .post('/api/v1/appointments/me')
        .set('Authorization', auth(patientPayload))
        .send({ doctorId: '11111111-1111-4111-8111-111111111111', startsAt, endsAt });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ patientId: '33333333-3333-4333-8333-333333333333' });
    });
  });

  describe('status state machine', () => {
    it('walks an appointment through confirm -> check-in -> waiting -> start -> complete', async () => {
      const { startsAt, endsAt } = future(40);
      const created = await request(server())
        .post('/api/v1/appointments')
        .set('Authorization', auth(adminAPayload))
        .send({
          doctorId: '11111111-1111-4111-8111-111111111111',
          patientId: '33333333-3333-4333-8333-333333333333',
          startsAt,
          endsAt,
        })
        .expect(201);
      const id = (created.body as { id: string }).id;

      await request(server())
        .post(`/api/v1/appointments/${id}/confirm`)
        .set('Authorization', auth(adminAPayload))
        .expect(201)
        .expect((r) => expect((r.body as { status: string }).status).toBe('CONFIRMED'));

      await request(server())
        .post(`/api/v1/appointments/${id}/check-in`)
        .set('Authorization', auth(adminAPayload))
        .expect(201);

      await request(server())
        .post(`/api/v1/appointments/${id}/waiting`)
        .set('Authorization', auth(adminAPayload))
        .expect(201);

      await request(server())
        .post(`/api/v1/appointments/${id}/start`)
        .set('Authorization', auth(doctorPayload))
        .expect(201);

      const completed = await request(server())
        .post(`/api/v1/appointments/${id}/complete`)
        .set('Authorization', auth(doctorPayload))
        .expect(201);
      expect((completed.body as { status: string }).status).toBe('COMPLETED');
    });

    it('rejects an illegal transition (SCHEDULED -> check-in, skipping CONFIRMED)', async () => {
      const { startsAt, endsAt } = future(41);
      const created = await request(server())
        .post('/api/v1/appointments')
        .set('Authorization', auth(adminAPayload))
        .send({
          doctorId: '11111111-1111-4111-8111-111111111111',
          patientId: '33333333-3333-4333-8333-333333333333',
          startsAt,
          endsAt,
        })
        .expect(201);
      const id = (created.body as { id: string }).id;

      const res = await request(server())
        .post(`/api/v1/appointments/${id}/check-in`)
        .set('Authorization', auth(adminAPayload));
      expect(res.status).toBe(409);
    });

    it("a Doctor cannot start/complete another doctor's appointment", async () => {
      const { startsAt, endsAt } = future(42);
      const created = await request(server())
        .post('/api/v1/appointments')
        .set('Authorization', auth(adminAPayload))
        .send({
          doctorId: '11111111-1111-4111-8111-111111111111',
          patientId: '33333333-3333-4333-8333-333333333333',
          startsAt,
          endsAt,
        })
        .expect(201);
      const id = (created.body as { id: string }).id;
      await request(server())
        .post(`/api/v1/appointments/${id}/confirm`)
        .set('Authorization', auth(adminAPayload))
        .expect(201);
      await request(server())
        .post(`/api/v1/appointments/${id}/check-in`)
        .set('Authorization', auth(adminAPayload))
        .expect(201);
      await request(server())
        .post(`/api/v1/appointments/${id}/waiting`)
        .set('Authorization', auth(adminAPayload))
        .expect(201);

      const res = await request(server())
        .post(`/api/v1/appointments/${id}/start`)
        .set('Authorization', auth(otherDoctorPayload));
      expect(res.status).toBe(403);
    });
  });

  describe('cancellation & reschedule', () => {
    it('a patient can cancel their own appointment', async () => {
      const { startsAt, endsAt } = future(50);
      const created = await request(server())
        .post('/api/v1/appointments/me')
        .set('Authorization', auth(patientPayload))
        .send({ doctorId: '11111111-1111-4111-8111-111111111111', startsAt, endsAt })
        .expect(201);
      const id = (created.body as { id: string }).id;

      const res = await request(server())
        .post(`/api/v1/appointments/${id}/cancel`)
        .set('Authorization', auth(patientPayload))
        .send({ reason: 'schedule conflict' });
      expect(res.status).toBe(201);
      expect((res.body as { status: string }).status).toBe('CANCELLED');
    });

    it("a patient cannot cancel another patient's appointment", async () => {
      const { startsAt, endsAt } = future(51);
      const created = await request(server())
        .post('/api/v1/appointments')
        .set('Authorization', auth(adminAPayload))
        .send({
          doctorId: '11111111-1111-4111-8111-111111111111',
          patientId: '44444444-4444-4444-8444-444444444444',
          startsAt,
          endsAt,
        })
        .expect(201);
      const id = (created.body as { id: string }).id;

      const res = await request(server())
        .post(`/api/v1/appointments/${id}/cancel`)
        .set('Authorization', auth(patientPayload))
        .send({});
      expect(res.status).toBe(403);
    });

    it('rescheduling into a slot that collides with another appointment is rejected', async () => {
      const first = future(60);
      const second = future(70);
      const created = await request(server())
        .post('/api/v1/appointments')
        .set('Authorization', auth(adminAPayload))
        .send({
          doctorId: '11111111-1111-4111-8111-111111111111',
          patientId: '33333333-3333-4333-8333-333333333333',
          ...first,
        })
        .expect(201);
      await request(server())
        .post('/api/v1/appointments')
        .set('Authorization', auth(adminAPayload))
        .send({
          doctorId: '11111111-1111-4111-8111-111111111111',
          patientId: '44444444-4444-4444-8444-444444444444',
          ...second,
        })
        .expect(201);

      const id = (created.body as { id: string }).id;
      const res = await request(server())
        .post(`/api/v1/appointments/${id}/reschedule`)
        .set('Authorization', auth(adminAPayload))
        .send(second);
      expect(res.status).toBe(409);
    });

    it('cannot reschedule a COMPLETED appointment', async () => {
      const { startsAt, endsAt } = future(80);
      const created = await request(server())
        .post('/api/v1/appointments')
        .set('Authorization', auth(adminAPayload))
        .send({
          doctorId: '11111111-1111-4111-8111-111111111111',
          patientId: '33333333-3333-4333-8333-333333333333',
          startsAt,
          endsAt,
        })
        .expect(201);
      const id = (created.body as { id: string }).id;
      await request(server())
        .post(`/api/v1/appointments/${id}/confirm`)
        .set('Authorization', auth(adminAPayload))
        .expect(201);
      await request(server())
        .post(`/api/v1/appointments/${id}/check-in`)
        .set('Authorization', auth(adminAPayload))
        .expect(201);
      await request(server())
        .post(`/api/v1/appointments/${id}/waiting`)
        .set('Authorization', auth(adminAPayload))
        .expect(201);
      await request(server())
        .post(`/api/v1/appointments/${id}/start`)
        .set('Authorization', auth(doctorPayload))
        .expect(201);
      await request(server())
        .post(`/api/v1/appointments/${id}/complete`)
        .set('Authorization', auth(doctorPayload))
        .expect(201);

      const res = await request(server())
        .post(`/api/v1/appointments/${id}/reschedule`)
        .set('Authorization', auth(adminAPayload))
        .send(future(81));
      expect(res.status).toBe(409);
    });
  });

  describe('tenant isolation', () => {
    it("Clinic B's admin cannot read Clinic A's appointment by id (404, not leaked)", async () => {
      const { startsAt, endsAt } = future(90);
      const created = await request(server())
        .post('/api/v1/appointments')
        .set('Authorization', auth(adminAPayload))
        .send({
          doctorId: '11111111-1111-4111-8111-111111111111',
          patientId: '33333333-3333-4333-8333-333333333333',
          startsAt,
          endsAt,
        })
        .expect(201);
      const id = (created.body as { id: string }).id;

      const res = await request(server())
        .get(`/api/v1/appointments/${id}`)
        .set('Authorization', auth(adminBPayload));
      expect(res.status).toBe(404);
    });
  });

  describe('doctor read scoping', () => {
    it("a Doctor's appointment list is scoped to their own appointments regardless of a doctorId query param", async () => {
      const res = await request(server())
        .get('/api/v1/appointments?doctorId=22222222-2222-4222-8222-222222222222')
        .set('Authorization', auth(doctorPayload));
      expect(res.status).toBe(200);
      const data = (res.body as { data: { doctorId: string }[] }).data;
      for (const appt of data) expect(appt.doctorId).toBe('11111111-1111-4111-8111-111111111111');
    });
  });
});
