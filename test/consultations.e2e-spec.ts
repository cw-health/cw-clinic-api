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
 * Exercises the consultations module end to end: creation gated on the
 * linked appointment's status, ownership scoping (a doctor only edits their
 * own consultation), the patient-history list (GET /consultations?patientId),
 * tenant isolation, and complete() cascading to the appointment.
 */
function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });
}

const CLINIC_A = 'clinic-a';
const CLINIC_B = 'clinic-b';
const DOCTOR_1 = '11111111-1111-4111-8111-111111111111';
const DOCTOR_2 = '22222222-2222-4222-8222-222222222222';
const PATIENT_1 = '33333333-3333-4333-8333-333333333333';

const doctorPayload: JwtPayload = {
  sub: 'user-doc-1',
  email: 'doc1@clinic-a.test',
  role: 'Doctor',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['consultations:create', 'consultations:read', 'consultations:update'],
};

const otherDoctorPayload: JwtPayload = {
  sub: 'user-doc-2',
  email: 'doc2@clinic-a.test',
  role: 'Doctor',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['consultations:create', 'consultations:read', 'consultations:update'],
};

const clinicAdminPayload: JwtPayload = {
  sub: 'user-admin-a',
  email: 'admin@clinic-a.test',
  role: 'ClinicAdmin',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['consultations:read'],
};

const adminBPayload: JwtPayload = {
  ...clinicAdminPayload,
  sub: 'user-admin-b',
  email: 'admin@clinic-b.test',
  clinicId: CLINIC_B,
  // Cross-tenant isolation probe: holds every consultations:* permission so
  // a rejection can only be the tenant-scoped 404, never a 403 confound.
  permissions: ['consultations:create', 'consultations:read', 'consultations:update'],
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

interface ConsultationRow {
  id: string;
  clinicId: string;
  appointmentId: string;
  doctorId: string;
  patientId: string;
  status: string;
  chiefComplaint: string;
  symptoms: string | null;
  history: string | null;
  heightCm: number | null;
  weightKg: number | null;
  temperatureCelsius: number | null;
  pulseBpm: number | null;
  bloodPressureSystolic: number | null;
  bloodPressureDiastolic: number | null;
  respiratoryRate: number | null;
  spo2Percent: number | null;
  examination: string | null;
  diagnosis: string | null;
  investigations: string | null;
  treatment: string | null;
  advice: string | null;
  followUpDate: Date | null;
  followUpInstructions: string | null;
  notes: string | null;
  templateKey: string | null;
  customFields: string | null;
  createdByUserId: string;
  completedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function matches<T extends object>(row: T, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    const value = (row as unknown as Record<string, unknown>)[key];
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const cond = condition as Record<string, unknown>;
      if ('not' in cond && value === cond.not) return false;
      if ('in' in cond && !(cond.in as unknown[]).includes(value)) return false;
    } else if (value !== condition) {
      return false;
    }
  }
  return true;
}

function makeFakePrisma() {
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

  const appointments = new Map<string, AppointmentRow>();
  const consultations = new Map<string, ConsultationRow>();
  const now = new Date();

  function seedAppointment(id: string, doctorId: string, status: string): void {
    appointments.set(id, {
      id,
      clinicId: CLINIC_A,
      doctorId,
      patientId: PATIENT_1,
      startsAt: now,
      endsAt: new Date(now.getTime() + 30 * 60_000),
      status,
      reasonForVisit: null,
      notes: null,
      createdByUserId: 'user-staff',
      confirmedAt: now,
      checkedInAt: now,
      consultationStartedAt: status === 'IN_CONSULTATION' ? now : null,
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
    consultation: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const found = [...consultations.values()].find((c) => matches(c, where));
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
          const all = [...consultations.values()]
            .filter((c) => matches(c, where))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return Promise.resolve(all.slice(skip, skip + take));
        },
      ),
      count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve([...consultations.values()].filter((c) => matches(c, where)).length),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        if ([...consultations.values()].some((c) => c.appointmentId === data.appointmentId)) {
          const err = new Error('Unique constraint violation') as Error & { code: string };
          err.code = 'P2002';
          throw err;
        }
        const row: ConsultationRow = {
          id: randomUUID(),
          clinicId: data.clinicId as string,
          appointmentId: data.appointmentId as string,
          doctorId: data.doctorId as string,
          patientId: data.patientId as string,
          status: 'IN_PROGRESS',
          chiefComplaint: data.chiefComplaint as string,
          symptoms: (data.symptoms as string) ?? null,
          history: (data.history as string) ?? null,
          heightCm: (data.heightCm as number) ?? null,
          weightKg: (data.weightKg as number) ?? null,
          temperatureCelsius: (data.temperatureCelsius as number) ?? null,
          pulseBpm: (data.pulseBpm as number) ?? null,
          bloodPressureSystolic: (data.bloodPressureSystolic as number) ?? null,
          bloodPressureDiastolic: (data.bloodPressureDiastolic as number) ?? null,
          respiratoryRate: (data.respiratoryRate as number) ?? null,
          spo2Percent: (data.spo2Percent as number) ?? null,
          examination: (data.examination as string) ?? null,
          diagnosis: (data.diagnosis as string) ?? null,
          investigations: (data.investigations as string) ?? null,
          treatment: (data.treatment as string) ?? null,
          advice: (data.advice as string) ?? null,
          followUpDate: (data.followUpDate as Date) ?? null,
          followUpInstructions: (data.followUpInstructions as string) ?? null,
          notes: (data.notes as string) ?? null,
          templateKey: (data.templateKey as string) ?? null,
          customFields: (data.customFields as string) ?? null,
          createdByUserId: data.createdByUserId as string,
          completedAt: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        consultations.set(row.id, row);
        return Promise.resolve(row);
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = consultations.get(where.id)!;
          Object.assign(row, data, { updatedAt: new Date() });
          return Promise.resolve(row);
        },
      ),
      updateMany: jest.fn(
        ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const rows = [...consultations.values()].filter((c) => matches(c, where));
          for (const row of rows) Object.assign(row, data, { updatedAt: new Date() });
          return Promise.resolve({ count: rows.length });
        },
      ),
    },
  };

  (fakePrisma as Record<string, unknown>).$transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(fakePrisma);
  });

  return { fakePrisma, seedAppointment, appointments, consultations };
}

describe('Consultations (e2e) — creation gating, ownership, history, tenant isolation', () => {
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
    harness.consultations.clear();
  });

  describe('authorization', () => {
    it('rejects with no token', async () => {
      const res = await request(server()).get('/api/v1/consultations');
      expect(res.status).toBe(401);
    });

    it('rejects a role without consultations:create', async () => {
      harness.seedAppointment('55555555-5555-4555-8555-555555555555', DOCTOR_1, 'WAITING');
      const res = await request(server())
        .post('/api/v1/consultations')
        .set('Authorization', auth(noPermissionPayload))
        .send({ appointmentId: '55555555-5555-4555-8555-555555555555', chiefComplaint: 'Fever' });
      expect(res.status).toBe(403);
    });
  });

  describe('create', () => {
    it('creates a consultation for a WAITING appointment and starts it', async () => {
      harness.seedAppointment('55555555-5555-4555-8555-555555555555', DOCTOR_1, 'WAITING');

      const res = await request(server())
        .post('/api/v1/consultations')
        .set('Authorization', auth(doctorPayload))
        .send({
          appointmentId: '55555555-5555-4555-8555-555555555555',
          chiefComplaint: 'Fever',
          diagnosis: undefined,
        });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        appointmentId: '55555555-5555-4555-8555-555555555555',
        status: 'IN_PROGRESS',
      });
      expect(harness.appointments.get('55555555-5555-4555-8555-555555555555')?.status).toBe(
        'IN_CONSULTATION',
      );
    });

    it("rejects a doctor creating a consultation for another doctor's appointment", async () => {
      harness.seedAppointment('55555555-5555-4555-8555-555555555555', DOCTOR_2, 'WAITING');

      const res = await request(server())
        .post('/api/v1/consultations')
        .set('Authorization', auth(doctorPayload))
        .send({ appointmentId: '55555555-5555-4555-8555-555555555555', chiefComplaint: 'Fever' });
      expect(res.status).toBe(403);
    });

    it('rejects creating a consultation before the patient is called in (still SCHEDULED)', async () => {
      harness.seedAppointment('55555555-5555-4555-8555-555555555555', DOCTOR_1, 'SCHEDULED');

      const res = await request(server())
        .post('/api/v1/consultations')
        .set('Authorization', auth(doctorPayload))
        .send({ appointmentId: '55555555-5555-4555-8555-555555555555', chiefComplaint: 'Fever' });
      expect(res.status).toBe(409);
    });

    it('rejects a duplicate consultation for the same appointment', async () => {
      harness.seedAppointment('55555555-5555-4555-8555-555555555555', DOCTOR_1, 'WAITING');
      await request(server())
        .post('/api/v1/consultations')
        .set('Authorization', auth(doctorPayload))
        .send({ appointmentId: '55555555-5555-4555-8555-555555555555', chiefComplaint: 'Fever' })
        .expect(201);

      const res = await request(server())
        .post('/api/v1/consultations')
        .set('Authorization', auth(doctorPayload))
        .send({ appointmentId: '55555555-5555-4555-8555-555555555555', chiefComplaint: 'Fever' });
      expect(res.status).toBe(409);
    });

    it('a cross-tenant appointment id 404s rather than leaking existence', async () => {
      harness.seedAppointment('55555555-5555-4555-8555-555555555555', DOCTOR_1, 'WAITING');

      const res = await request(server())
        .post('/api/v1/consultations')
        .set('Authorization', auth(adminBPayload))
        .send({ appointmentId: '55555555-5555-4555-8555-555555555555', chiefComplaint: 'Fever' });
      expect(res.status).toBe(404);
    });
  });

  describe('update & complete', () => {
    async function createConsultation() {
      harness.seedAppointment('55555555-5555-4555-8555-555555555555', DOCTOR_1, 'WAITING');
      const created = await request(server())
        .post('/api/v1/consultations')
        .set('Authorization', auth(doctorPayload))
        .send({ appointmentId: '55555555-5555-4555-8555-555555555555', chiefComplaint: 'Fever' })
        .expect(201);
      return (created.body as { id: string }).id;
    }

    it("rejects a doctor updating another doctor's consultation", async () => {
      const id = await createConsultation();

      const res = await request(server())
        .patch(`/api/v1/consultations/${id}`)
        .set('Authorization', auth(otherDoctorPayload))
        .send({ diagnosis: 'Flu' });
      expect(res.status).toBe(403);
    });

    it('completing the consultation also completes the linked appointment', async () => {
      const id = await createConsultation();

      const res = await request(server())
        .post(`/api/v1/consultations/${id}/complete`)
        .set('Authorization', auth(doctorPayload));
      expect(res.status).toBe(201);
      expect((res.body as { status: string }).status).toBe('COMPLETED');
      expect(harness.appointments.get('55555555-5555-4555-8555-555555555555')?.status).toBe(
        'COMPLETED',
      );
    });

    it('rejects updating an already-completed consultation', async () => {
      const id = await createConsultation();
      await request(server())
        .post(`/api/v1/consultations/${id}/complete`)
        .set('Authorization', auth(doctorPayload))
        .expect(201);

      const res = await request(server())
        .patch(`/api/v1/consultations/${id}`)
        .set('Authorization', auth(doctorPayload))
        .send({ diagnosis: 'Flu' });
      expect(res.status).toBe(409);
    });
  });

  describe('history — GET /consultations?patientId=', () => {
    it("lists a patient's previous consultations, most recent first", async () => {
      harness.seedAppointment('55555555-5555-4555-8555-555555555555', DOCTOR_1, 'WAITING');
      await request(server())
        .post('/api/v1/consultations')
        .set('Authorization', auth(doctorPayload))
        .send({
          appointmentId: '55555555-5555-4555-8555-555555555555',
          chiefComplaint: 'Fever',
          diagnosis: 'Flu',
        })
        .expect(201);

      const res = await request(server())
        .get(`/api/v1/consultations?patientId=${PATIENT_1}`)
        .set('Authorization', auth(clinicAdminPayload));
      expect(res.status).toBe(200);
      const body = res.body as { data: { diagnosis: string | null }[] };
      expect(body.data).toHaveLength(1);
      expect(body.data[0].diagnosis).toBe('Flu');
    });

    it('a cross-tenant caller sees an empty history for the same patientId', async () => {
      harness.seedAppointment('55555555-5555-4555-8555-555555555555', DOCTOR_1, 'WAITING');
      await request(server())
        .post('/api/v1/consultations')
        .set('Authorization', auth(doctorPayload))
        .send({ appointmentId: '55555555-5555-4555-8555-555555555555', chiefComplaint: 'Fever' })
        .expect(201);

      const res = await request(server())
        .get(`/api/v1/consultations?patientId=${PATIENT_1}`)
        .set('Authorization', auth(adminBPayload));
      expect(res.status).toBe(200);
      expect((res.body as { data: unknown[] }).data).toEqual([]);
    });
  });
});
