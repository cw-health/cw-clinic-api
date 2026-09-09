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
 * Exercises the Clinical Record upgrade end to end (docs/DATABASE.md §16):
 * structured diagnoses, structured investigation orders, and controlled
 * amendment of a locked (COMPLETED) consultation — the pipeline pieces
 * added on top of the existing consultation workflow (already covered by
 * consultations.e2e-spec.ts, unchanged here).
 */
function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });
}

const CLINIC_A = 'clinic-a';
const DOCTOR_1 = '11111111-1111-4111-8111-111111111111';
const DOCTOR_2 = '22222222-2222-4222-8222-222222222222';
const PATIENT_1 = '33333333-3333-4333-8333-333333333333';
const APPOINTMENT_1 = '55555555-5555-4555-8555-555555555555';

const doctorPayload: JwtPayload = {
  sub: 'user-doc-1',
  email: 'doc1@clinic-a.test',
  role: 'Doctor',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: [
    'consultations:create',
    'consultations:read',
    'consultations:update',
    'consultations:amend',
    'diagnoses:create',
    'diagnoses:read',
    'diagnoses:delete',
    'investigations:create',
    'investigations:read',
    'investigations:update',
  ],
};

const otherDoctorPayload: JwtPayload = {
  ...doctorPayload,
  sub: 'user-doc-2',
  email: 'doc2@clinic-a.test',
};

const clinicAdminPayload: JwtPayload = {
  sub: 'user-admin-a',
  email: 'admin@clinic-a.test',
  role: 'ClinicAdmin',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  // ClinicAdmin is deliberately read-only here — never amend/create/delete
  // grants, mirroring the "ClinicAdmin never edits clinical content" rule.
  permissions: ['consultations:read', 'diagnoses:read', 'investigations:read'],
};

interface ConsultationRow {
  id: string;
  clinicId: string;
  appointmentId: string;
  doctorId: string;
  patientId: string;
  status: string;
  chiefComplaint: string;
  diagnosis: string | null;
  [key: string]: unknown;
}

interface DiagnosisRow {
  id: string;
  clinicId: string;
  consultationId: string;
  doctorId: string;
  type: string;
  description: string;
  icdCode: string | null;
  sortOrder: number;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface InvestigationOrderRow {
  id: string;
  clinicId: string;
  consultationId: string;
  doctorId: string;
  testName: string;
  category: string | null;
  priority: string;
  clinicalNotes: string | null;
  status: string;
  createdByUserId: string;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface AmendmentRow {
  id: string;
  clinicId: string;
  consultationId: string;
  amendedByUserId: string;
  reason: string;
  changedFields: string;
  previousValues: string;
  createdAt: Date;
}

function matches<T extends object>(row: T, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    const value = (row as unknown as Record<string, unknown>)[key];
    if (value !== condition) return false;
  }
  return true;
}

function makeFakePrisma() {
  const now = new Date();
  const doctors = new Map([
    [
      DOCTOR_1,
      {
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
      },
    ],
    [
      DOCTOR_2,
      {
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
      },
    ],
  ]);
  const patients = new Map([
    [PATIENT_1, { id: PATIENT_1, clinicId: CLINIC_A, firstName: 'Mary', lastName: 'Jackson' }],
  ]);

  const consultations = new Map<string, ConsultationRow>();
  const diagnoses = new Map<string, DiagnosisRow>();
  const investigationOrders = new Map<string, InvestigationOrderRow>();
  const amendments = new Map<string, AmendmentRow>();

  function seedConsultation(status: 'IN_PROGRESS' | 'COMPLETED' = 'IN_PROGRESS'): string {
    const id = randomUUID();
    consultations.set(id, {
      id,
      clinicId: CLINIC_A,
      appointmentId: APPOINTMENT_1,
      doctorId: DOCTOR_1,
      patientId: PATIENT_1,
      status,
      chiefComplaint: 'Fever',
      diagnosis: null,
      deletedAt: null,
    });
    return id;
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
    consultation: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve([...consultations.values()].find((c) => matches(c, where)) ?? null),
      ),
      updateMany: jest.fn(
        ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const rows = [...consultations.values()].filter((c) => matches(c, where));
          for (const row of rows) Object.assign(row, data);
          return Promise.resolve({ count: rows.length });
        },
      ),
    },
    diagnosis: {
      count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve([...diagnoses.values()].filter((d) => matches(d, where)).length),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row: DiagnosisRow = {
          id: randomUUID(),
          clinicId: data.clinicId as string,
          consultationId: data.consultationId as string,
          doctorId: data.doctorId as string,
          type: data.type as string,
          description: data.description as string,
          icdCode: (data.icdCode as string) ?? null,
          sortOrder: data.sortOrder as number,
          createdByUserId: data.createdByUserId as string,
          createdAt: now,
          updatedAt: now,
        };
        diagnoses.set(row.id, row);
        return Promise.resolve(row);
      }),
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve([...diagnoses.values()].filter((d) => matches(d, where))),
      ),
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve([...diagnoses.values()].find((d) => matches(d, where)) ?? null),
      ),
      deleteMany: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const rows = [...diagnoses.values()].filter((d) => matches(d, where));
        for (const row of rows) diagnoses.delete(row.id);
        return Promise.resolve({ count: rows.length });
      }),
    },
    investigationOrder: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row: InvestigationOrderRow = {
          id: randomUUID(),
          clinicId: data.clinicId as string,
          consultationId: data.consultationId as string,
          doctorId: data.doctorId as string,
          testName: data.testName as string,
          category: (data.category as string) ?? null,
          priority: data.priority as string,
          clinicalNotes: (data.clinicalNotes as string) ?? null,
          status: 'ORDERED',
          createdByUserId: data.createdByUserId as string,
          cancelledAt: null,
          createdAt: now,
          updatedAt: now,
        };
        investigationOrders.set(row.id, row);
        return Promise.resolve(row);
      }),
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve([...investigationOrders.values()].filter((o) => matches(o, where))),
      ),
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve([...investigationOrders.values()].find((o) => matches(o, where)) ?? null),
      ),
      updateMany: jest.fn(
        ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const rows = [...investigationOrders.values()].filter((o) => matches(o, where));
          for (const row of rows) Object.assign(row, data);
          return Promise.resolve({ count: rows.length });
        },
      ),
    },
    consultationAmendment: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row: AmendmentRow = {
          id: randomUUID(),
          clinicId: data.clinicId as string,
          consultationId: data.consultationId as string,
          amendedByUserId: data.amendedByUserId as string,
          reason: data.reason as string,
          changedFields: data.changedFields as string,
          previousValues: data.previousValues as string,
          createdAt: now,
        };
        amendments.set(row.id, row);
        return Promise.resolve(row);
      }),
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          [...amendments.values()]
            .filter((a) => matches(a, where))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
        ),
      ),
    },
  };

  (fakePrisma as Record<string, unknown>).$transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(fakePrisma);
  });

  return {
    fakePrisma,
    consultations,
    diagnoses,
    investigationOrders,
    amendments,
    seedConsultation,
  };
}

describe('Clinical Record upgrade (e2e) — diagnoses, investigation orders, amendment', () => {
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
    harness.consultations.clear();
    harness.diagnoses.clear();
    harness.investigationOrders.clear();
    harness.amendments.clear();
  });

  describe('diagnoses', () => {
    it('a doctor adds a structured diagnosis to their own in-progress consultation', async () => {
      const consultationId = harness.seedConsultation('IN_PROGRESS');

      const res = await request(server())
        .post(`/api/v1/consultations/${consultationId}/diagnoses`)
        .set('Authorization', auth(doctorPayload))
        .send({ type: 'PRIMARY', description: 'Influenza' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ type: 'PRIMARY', description: 'Influenza' });

      const list = await request(server())
        .get(`/api/v1/consultations/${consultationId}/diagnoses`)
        .set('Authorization', auth(clinicAdminPayload));
      expect(list.status).toBe(200);
      expect(list.body as unknown[]).toHaveLength(1);
    });

    it("rejects a doctor adding a diagnosis to another doctor's consultation", async () => {
      const consultationId = harness.seedConsultation('IN_PROGRESS');

      const res = await request(server())
        .post(`/api/v1/consultations/${consultationId}/diagnoses`)
        .set('Authorization', auth(otherDoctorPayload))
        .send({ type: 'PRIMARY', description: 'Influenza' });
      expect(res.status).toBe(403);
    });

    it('rejects adding a diagnosis once the consultation is completed', async () => {
      const consultationId = harness.seedConsultation('COMPLETED');

      const res = await request(server())
        .post(`/api/v1/consultations/${consultationId}/diagnoses`)
        .set('Authorization', auth(doctorPayload))
        .send({ type: 'PRIMARY', description: 'Influenza' });
      expect(res.status).toBe(409);
    });

    it('rejects ClinicAdmin creating a diagnosis (read-only oversight only)', async () => {
      const consultationId = harness.seedConsultation('IN_PROGRESS');

      const res = await request(server())
        .post(`/api/v1/consultations/${consultationId}/diagnoses`)
        .set('Authorization', auth(clinicAdminPayload))
        .send({ type: 'PRIMARY', description: 'Influenza' });
      expect(res.status).toBe(403);
    });
  });

  describe('investigation orders', () => {
    it('a doctor orders and then cancels an investigation', async () => {
      const consultationId = harness.seedConsultation('IN_PROGRESS');

      const created = await request(server())
        .post(`/api/v1/consultations/${consultationId}/investigation-orders`)
        .set('Authorization', auth(doctorPayload))
        .send({ testName: 'Complete Blood Count', category: 'Lab' });
      expect(created.status).toBe(201);
      expect((created.body as { status: string }).status).toBe('ORDERED');
      const orderId = (created.body as { id: string }).id;

      const cancelled = await request(server())
        .post(`/api/v1/investigation-orders/${orderId}/cancel`)
        .set('Authorization', auth(doctorPayload));
      expect(cancelled.status).toBe(201);
      expect((cancelled.body as { status: string }).status).toBe('CANCELLED');

      const recancel = await request(server())
        .post(`/api/v1/investigation-orders/${orderId}/cancel`)
        .set('Authorization', auth(doctorPayload));
      expect(recancel.status).toBe(409);
    });

    it('rejects ordering an investigation once the consultation is completed', async () => {
      const consultationId = harness.seedConsultation('COMPLETED');

      const res = await request(server())
        .post(`/api/v1/consultations/${consultationId}/investigation-orders`)
        .set('Authorization', auth(doctorPayload))
        .send({ testName: 'Chest X-Ray' });
      expect(res.status).toBe(409);
    });
  });

  describe('amendment of a completed consultation', () => {
    it('rejects a plain update once completed, accepts an amend with a reason, and records history', async () => {
      const consultationId = harness.seedConsultation('COMPLETED');
      harness.consultations.get(consultationId)!.diagnosis = 'Common cold';

      const blocked = await request(server())
        .patch(`/api/v1/consultations/${consultationId}`)
        .set('Authorization', auth(doctorPayload))
        .send({ diagnosis: 'Influenza' });
      expect(blocked.status).toBe(409);

      const amended = await request(server())
        .post(`/api/v1/consultations/${consultationId}/amend`)
        .set('Authorization', auth(doctorPayload))
        .send({ reason: 'Corrected after lab result came back', diagnosis: 'Influenza' });
      expect(amended.status).toBe(201);
      expect((amended.body as { diagnosis: string }).diagnosis).toBe('Influenza');

      const history = await request(server())
        .get(`/api/v1/consultations/${consultationId}/amendments`)
        .set('Authorization', auth(clinicAdminPayload));
      expect(history.status).toBe(200);
      const entries = history.body as {
        reason: string;
        changedFields: string;
        previousValues: Record<string, unknown>;
      }[];
      expect(entries).toHaveLength(1);
      expect(entries[0].reason).toBe('Corrected after lab result came back');
      expect(entries[0].changedFields).toBe('diagnosis');
      expect(entries[0].previousValues).toEqual({ diagnosis: 'Common cold' });
    });

    it('rejects ClinicAdmin amending a consultation (read-only oversight only)', async () => {
      const consultationId = harness.seedConsultation('COMPLETED');

      const res = await request(server())
        .post(`/api/v1/consultations/${consultationId}/amend`)
        .set('Authorization', auth(clinicAdminPayload))
        .send({ reason: 'Trying to edit', diagnosis: 'Influenza' });
      expect(res.status).toBe(403);
    });

    it('rejects amending a consultation that is still in progress', async () => {
      const consultationId = harness.seedConsultation('IN_PROGRESS');

      const res = await request(server())
        .post(`/api/v1/consultations/${consultationId}/amend`)
        .set('Authorization', auth(doctorPayload))
        .send({ reason: 'Too early', diagnosis: 'Influenza' });
      expect(res.status).toBe(409);
    });
  });
});
