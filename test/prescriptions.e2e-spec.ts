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
 * Exercises the prescriptions module end to end: doctor ownership, the
 * DRAFT -> FINALIZED lifecycle (immutability once finalized), the amend
 * (version chain) flow, patient self-service history (drafts hidden),
 * secure PDF download-token issuance + the public token-verified PDF
 * route, and tenant isolation.
 */
function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });
}

const CLINIC_A = 'clinic-a';
const CLINIC_B = 'clinic-b';
const DOCTOR_1 = '11111111-1111-4111-8111-111111111111';
const DOCTOR_2 = '22222222-2222-4222-8222-222222222222';
const PATIENT_1 = '33333333-3333-4333-8333-333333333333';
const CONSULTATION_1 = '44444444-4444-4444-8444-444444444444';
const MEDICINE_ACTIVE = '55555555-5555-4555-8555-555555555555';
const MEDICINE_INACTIVE = '66666666-6666-4666-8666-666666666666';

const doctorPayload: JwtPayload = {
  sub: 'user-doc-1',
  email: 'doc1@clinic-a.test',
  role: 'Doctor',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: [
    'prescriptions:create',
    'prescriptions:read',
    'prescriptions:update',
    'medicines:read',
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
  permissions: ['prescriptions:read', 'medicines:read', 'medicines:manage'],
};

const adminBPayload: JwtPayload = {
  ...clinicAdminPayload,
  sub: 'user-admin-b',
  email: 'admin@clinic-b.test',
  clinicId: CLINIC_B,
  permissions: ['prescriptions:read', 'prescriptions:create', 'prescriptions:update'],
};

const patientPayload: JwtPayload = {
  sub: 'user-patient-1',
  email: 'patient1@clinic-a.test',
  role: 'Patient',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['prescriptions:read-own'],
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

interface PrescriptionRow {
  id: string;
  clinicId: string;
  consultationId: string;
  doctorId: string;
  patientId: string;
  status: string;
  version: number;
  amendsId: string | null;
  notes: string | null;
  createdByUserId: string;
  finalizedAt: Date | null;
  supersededAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PrescriptionItemRow {
  id: string;
  prescriptionId: string;
  medicineId: string;
  medicineName: string;
  dosage: string;
  frequency: string;
  duration: string;
  route: string | null;
  instructions: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

function makeFakePrisma() {
  const now = new Date();

  const doctors = new Map<string, { id: string; clinicId: string; userId: string }>([
    [DOCTOR_1, { id: DOCTOR_1, clinicId: CLINIC_A, userId: doctorPayload.sub }],
    [DOCTOR_2, { id: DOCTOR_2, clinicId: CLINIC_A, userId: otherDoctorPayload.sub }],
  ]);
  const doctorNames: Record<string, { firstName: string; lastName: string }> = {
    [DOCTOR_1]: { firstName: 'Ada', lastName: 'Lovelace' },
    [DOCTOR_2]: { firstName: 'Grace', lastName: 'Hopper' },
  };

  const patients = new Map<string, { id: string; clinicId: string; userId: string | null }>([
    [PATIENT_1, { id: PATIENT_1, clinicId: CLINIC_A, userId: patientPayload.sub }],
  ]);

  const consultations = new Map([
    [
      CONSULTATION_1,
      { id: CONSULTATION_1, clinicId: CLINIC_A, doctorId: DOCTOR_1, patientId: PATIENT_1 },
    ],
  ]);

  const clinics = new Map([[CLINIC_A, { id: CLINIC_A, name: 'Clinic A' }]]);

  const medicines = new Map([
    [
      MEDICINE_ACTIVE,
      { id: MEDICINE_ACTIVE, clinicId: CLINIC_A, name: 'Paracetamol', isActive: true },
    ],
    [
      MEDICINE_INACTIVE,
      { id: MEDICINE_INACTIVE, clinicId: CLINIC_A, name: 'Retired Drug', isActive: false },
    ],
  ]);

  const prescriptions = new Map<string, PrescriptionRow>();
  const prescriptionItems = new Map<string, PrescriptionItemRow>();

  function itemsFor(prescriptionId: string): PrescriptionItemRow[] {
    return [...prescriptionItems.values()]
      .filter((i) => i.prescriptionId === prescriptionId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  function withItems(row: PrescriptionRow) {
    return { ...row, items: itemsFor(row.id) };
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
          return Promise.resolve({
            ...doctor,
            deletedAt: null,
            status: 'ACTIVE',
            user: { id: doctor.userId, ...doctorNames[doctor.id] },
            specializations: [],
          });
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
          return Promise.resolve({
            ...patient,
            deletedAt: null,
            firstName: 'Mary',
            lastName: 'Jackson',
          });
        },
      ),
    },
    consultation: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const found = [...consultations.values()].find((c) =>
          matches(c, { ...where, deletedAt: undefined }),
        );
        return Promise.resolve(found ?? null);
      }),
    },
    clinic: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(clinics.get(where.id) ?? null),
      ),
    },
    medicine: {
      findFirst: jest.fn(({ where }: { where: { id: string; clinicId: string } }) => {
        const medicine = medicines.get(where.id);
        if (!medicine || medicine.clinicId !== where.clinicId) return Promise.resolve(null);
        return Promise.resolve(medicine);
      }),
    },
    prescription: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const found = [...prescriptions.values()].find((p) => matches(p, where));
        return Promise.resolve(found ? withItems(found) : null);
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
          const all = [...prescriptions.values()]
            .filter((p) => matches(p, where))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .map(withItems);
          return Promise.resolve(all.slice(skip, skip + take));
        },
      ),
      count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve([...prescriptions.values()].filter((p) => matches(p, where)).length),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row: PrescriptionRow = {
          id: randomUUID(),
          clinicId: data.clinicId as string,
          consultationId: data.consultationId as string,
          doctorId: data.doctorId as string,
          patientId: data.patientId as string,
          status: 'DRAFT',
          version: (data.version as number) ?? 1,
          amendsId: (data.amendsId as string) ?? null,
          notes: (data.notes as string) ?? null,
          createdByUserId: data.createdByUserId as string,
          finalizedAt: null,
          supersededAt: null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        prescriptions.set(row.id, row);
        return Promise.resolve(withItems(row));
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = prescriptions.get(where.id)!;
          Object.assign(row, data, { updatedAt: new Date() });
          return Promise.resolve(withItems(row));
        },
      ),
      updateMany: jest.fn(
        ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const rows = [...prescriptions.values()].filter((p) => matches(p, where));
          for (const row of rows) Object.assign(row, data, { updatedAt: new Date() });
          return Promise.resolve({ count: rows.length });
        },
      ),
    },
    prescriptionItem: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const item: PrescriptionItemRow = {
          id: randomUUID(),
          prescriptionId: data.prescriptionId as string,
          medicineId: data.medicineId as string,
          medicineName: data.medicineName as string,
          dosage: data.dosage as string,
          frequency: data.frequency as string,
          duration: data.duration as string,
          route: (data.route as string) ?? null,
          instructions: (data.instructions as string) ?? null,
          sortOrder: data.sortOrder as number,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        prescriptionItems.set(item.id, item);
        return Promise.resolve(item);
      }),
      createMany: jest.fn(({ data }: { data: Record<string, unknown>[] }) => {
        for (const entry of data) {
          const item: PrescriptionItemRow = {
            id: randomUUID(),
            prescriptionId: entry.prescriptionId as string,
            medicineId: entry.medicineId as string,
            medicineName: entry.medicineName as string,
            dosage: entry.dosage as string,
            frequency: entry.frequency as string,
            duration: entry.duration as string,
            route: (entry.route as string) ?? null,
            instructions: (entry.instructions as string) ?? null,
            sortOrder: entry.sortOrder as number,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          prescriptionItems.set(item.id, item);
        }
        return Promise.resolve({ count: data.length });
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const item = prescriptionItems.get(where.id)!;
          Object.assign(
            item,
            Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
            { updatedAt: new Date() },
          );
          return Promise.resolve(item);
        },
      ),
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        const item = prescriptionItems.get(where.id)!;
        prescriptionItems.delete(where.id);
        return Promise.resolve(item);
      }),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string; prescriptionId: string };
          data: Record<string, unknown>;
        }) => {
          const item = prescriptionItems.get(where.id);
          if (!item || item.prescriptionId !== where.prescriptionId) {
            return Promise.resolve({ count: 0 });
          }
          Object.assign(
            item,
            Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
            { updatedAt: new Date() },
          );
          return Promise.resolve({ count: 1 });
        },
      ),
      deleteMany: jest.fn(({ where }: { where: { id: string; prescriptionId: string } }) => {
        const item = prescriptionItems.get(where.id);
        if (!item || item.prescriptionId !== where.prescriptionId) {
          return Promise.resolve({ count: 0 });
        }
        prescriptionItems.delete(where.id);
        return Promise.resolve({ count: 1 });
      }),
    },
  };

  (fakePrisma as Record<string, unknown>).$transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(fakePrisma);
  });

  return { fakePrisma, prescriptions, prescriptionItems, now };
}

describe('Prescriptions (e2e) — lifecycle, amendment, patient self-service, secure PDF, tenant isolation', () => {
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
    harness.prescriptions.clear();
    harness.prescriptionItems.clear();
  });

  describe('authorization', () => {
    it('rejects with no token', async () => {
      const res = await request(server()).get('/api/v1/prescriptions');
      expect(res.status).toBe(401);
    });

    it('rejects a role without prescriptions:create', async () => {
      const res = await request(server())
        .post('/api/v1/prescriptions')
        .set('Authorization', auth(noPermissionPayload))
        .send({ consultationId: CONSULTATION_1 });
      expect(res.status).toBe(403);
    });
  });

  describe('create', () => {
    it('creates a draft prescription for a consultation', async () => {
      const res = await request(server())
        .post('/api/v1/prescriptions')
        .set('Authorization', auth(doctorPayload))
        .send({ consultationId: CONSULTATION_1 });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        consultationId: CONSULTATION_1,
        status: 'DRAFT',
        version: 1,
        items: [],
      });
    });

    it("rejects a doctor creating a prescription for another doctor's consultation", async () => {
      const res = await request(server())
        .post('/api/v1/prescriptions')
        .set('Authorization', auth(otherDoctorPayload))
        .send({ consultationId: CONSULTATION_1 });
      // otherDoctorPayload resolves to DOCTOR_2's own profile, which doesn't
      // match CONSULTATION_1's doctorId (DOCTOR_1) — ownership scope rejects it.
      expect(res.status).toBe(403);
    });

    it('rejects a second draft for the same consultation', async () => {
      await request(server())
        .post('/api/v1/prescriptions')
        .set('Authorization', auth(doctorPayload))
        .send({ consultationId: CONSULTATION_1 })
        .expect(201);

      const res = await request(server())
        .post('/api/v1/prescriptions')
        .set('Authorization', auth(doctorPayload))
        .send({ consultationId: CONSULTATION_1 });
      expect(res.status).toBe(409);
    });

    it('a cross-tenant consultation id 404s rather than leaking existence', async () => {
      const res = await request(server())
        .post('/api/v1/prescriptions')
        .set('Authorization', auth(adminBPayload))
        .send({ consultationId: CONSULTATION_1 });
      expect(res.status).toBe(404);
    });
  });

  describe('items + finalize', () => {
    async function createDraft() {
      const created = await request(server())
        .post('/api/v1/prescriptions')
        .set('Authorization', auth(doctorPayload))
        .send({ consultationId: CONSULTATION_1 })
        .expect(201);
      return (created.body as { id: string }).id;
    }

    it('adds an active medicine as a line item', async () => {
      const id = await createDraft();
      const res = await request(server())
        .post(`/api/v1/prescriptions/${id}/items`)
        .set('Authorization', auth(doctorPayload))
        .send({
          medicineId: MEDICINE_ACTIVE,
          dosage: '500mg',
          frequency: 'twice daily',
          duration: '5 days',
        });
      expect(res.status).toBe(201);
      expect((res.body as { items: unknown[] }).items).toHaveLength(1);
    });

    it('rejects adding an inactive medicine', async () => {
      const id = await createDraft();
      const res = await request(server())
        .post(`/api/v1/prescriptions/${id}/items`)
        .set('Authorization', auth(doctorPayload))
        .send({
          medicineId: MEDICINE_INACTIVE,
          dosage: '500mg',
          frequency: 'twice daily',
          duration: '5 days',
        });
      expect(res.status).toBe(409);
    });

    it('rejects finalizing a prescription with no items', async () => {
      const id = await createDraft();
      const res = await request(server())
        .post(`/api/v1/prescriptions/${id}/finalize`)
        .set('Authorization', auth(doctorPayload));
      expect(res.status).toBe(400);
    });

    it('finalizes a prescription with at least one item, then blocks further edits', async () => {
      const id = await createDraft();
      await request(server())
        .post(`/api/v1/prescriptions/${id}/items`)
        .set('Authorization', auth(doctorPayload))
        .send({
          medicineId: MEDICINE_ACTIVE,
          dosage: '500mg',
          frequency: 'twice daily',
          duration: '5 days',
        })
        .expect(201);

      const finalized = await request(server())
        .post(`/api/v1/prescriptions/${id}/finalize`)
        .set('Authorization', auth(doctorPayload));
      expect(finalized.status).toBe(201);
      expect((finalized.body as { status: string }).status).toBe('FINALIZED');

      const blockedItemAdd = await request(server())
        .post(`/api/v1/prescriptions/${id}/items`)
        .set('Authorization', auth(doctorPayload))
        .send({
          medicineId: MEDICINE_ACTIVE,
          dosage: '250mg',
          frequency: 'once daily',
          duration: '3 days',
        });
      expect(blockedItemAdd.status).toBe(409);

      const blockedNotesUpdate = await request(server())
        .patch(`/api/v1/prescriptions/${id}`)
        .set('Authorization', auth(doctorPayload))
        .send({ notes: 'edited after finalize' });
      expect(blockedNotesUpdate.status).toBe(409);
    });
  });

  describe('amend', () => {
    async function createFinalized() {
      const created = await request(server())
        .post('/api/v1/prescriptions')
        .set('Authorization', auth(doctorPayload))
        .send({ consultationId: CONSULTATION_1 })
        .expect(201);
      const id = (created.body as { id: string }).id;
      await request(server())
        .post(`/api/v1/prescriptions/${id}/items`)
        .set('Authorization', auth(doctorPayload))
        .send({
          medicineId: MEDICINE_ACTIVE,
          dosage: '500mg',
          frequency: 'twice daily',
          duration: '5 days',
        })
        .expect(201);
      await request(server())
        .post(`/api/v1/prescriptions/${id}/finalize`)
        .set('Authorization', auth(doctorPayload))
        .expect(201);
      return id;
    }

    it('rejects amending a draft prescription', async () => {
      const created = await request(server())
        .post('/api/v1/prescriptions')
        .set('Authorization', auth(doctorPayload))
        .send({ consultationId: CONSULTATION_1 })
        .expect(201);
      const id = (created.body as { id: string }).id;

      const res = await request(server())
        .post(`/api/v1/prescriptions/${id}/amend`)
        .set('Authorization', auth(doctorPayload));
      expect(res.status).toBe(409);
    });

    it('amending clones items into a new DRAFT version and, on finalizing that, supersedes the original', async () => {
      const originalId = await createFinalized();

      const amended = await request(server())
        .post(`/api/v1/prescriptions/${originalId}/amend`)
        .set('Authorization', auth(doctorPayload));
      expect(amended.status).toBe(201);
      const amendedBody = amended.body as {
        id: string;
        status: string;
        version: number;
        amendsId: string;
        items: unknown[];
      };
      expect(amendedBody.status).toBe('DRAFT');
      expect(amendedBody.version).toBe(2);
      expect(amendedBody.amendsId).toBe(originalId);
      expect(amendedBody.items).toHaveLength(1);

      // The original stays FINALIZED (current) until the amendment itself finalizes.
      const originalMidway = await request(server())
        .get(`/api/v1/prescriptions/${originalId}`)
        .set('Authorization', auth(doctorPayload));
      expect((originalMidway.body as { status: string }).status).toBe('FINALIZED');

      await request(server())
        .post(`/api/v1/prescriptions/${amendedBody.id}/finalize`)
        .set('Authorization', auth(doctorPayload))
        .expect(201);

      const originalAfter = await request(server())
        .get(`/api/v1/prescriptions/${originalId}`)
        .set('Authorization', auth(doctorPayload));
      expect((originalAfter.body as { status: string }).status).toBe('SUPERSEDED');
    });

    it('rejects a second amendment while one is already pending', async () => {
      const originalId = await createFinalized();
      await request(server())
        .post(`/api/v1/prescriptions/${originalId}/amend`)
        .set('Authorization', auth(doctorPayload))
        .expect(201);

      const res = await request(server())
        .post(`/api/v1/prescriptions/${originalId}/amend`)
        .set('Authorization', auth(doctorPayload));
      expect(res.status).toBe(409);
    });
  });

  describe('patient self-service — GET /prescriptions/me', () => {
    async function createFinalized() {
      const created = await request(server())
        .post('/api/v1/prescriptions')
        .set('Authorization', auth(doctorPayload))
        .send({ consultationId: CONSULTATION_1 })
        .expect(201);
      const id = (created.body as { id: string }).id;
      await request(server())
        .post(`/api/v1/prescriptions/${id}/items`)
        .set('Authorization', auth(doctorPayload))
        .send({
          medicineId: MEDICINE_ACTIVE,
          dosage: '500mg',
          frequency: 'twice daily',
          duration: '5 days',
        })
        .expect(201);
      return id;
    }

    it('a finalized prescription is visible to the patient; a draft is not', async () => {
      const finalizedId = await createFinalized();
      await request(server())
        .post(`/api/v1/prescriptions/${finalizedId}/finalize`)
        .set('Authorization', auth(doctorPayload))
        .expect(201);

      // A second, still-draft consultation prescription stays invisible.
      harness.prescriptions.set(randomUUID(), {
        id: 'draft-noise',
        clinicId: CLINIC_A,
        consultationId: CONSULTATION_1,
        doctorId: DOCTOR_1,
        patientId: PATIENT_1,
        status: 'DRAFT',
        version: 1,
        amendsId: null,
        notes: null,
        createdByUserId: doctorPayload.sub,
        finalizedAt: null,
        supersededAt: null,
        deletedAt: null,
        createdAt: harness.now,
        updatedAt: harness.now,
      });

      const res = await request(server())
        .get('/api/v1/prescriptions/me')
        .set('Authorization', auth(patientPayload));
      expect(res.status).toBe(200);
      const body = res.body as { data: { id: string; status: string }[] };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({ id: finalizedId, status: 'FINALIZED' });
    });

    it("rejects a different patient's GET /:id", async () => {
      const finalizedId = await createFinalized();
      await request(server())
        .post(`/api/v1/prescriptions/${finalizedId}/finalize`)
        .set('Authorization', auth(doctorPayload))
        .expect(201);

      const otherPatientPayload: JwtPayload = {
        ...patientPayload,
        sub: 'user-someone-else',
      };
      const res = await request(server())
        .get(`/api/v1/prescriptions/${finalizedId}`)
        .set('Authorization', auth(otherPatientPayload));
      // patientsService.findOwn 404s for a userId with no Patient row.
      expect(res.status).toBe(404);
    });
  });

  describe('secure PDF download', () => {
    async function createFinalized() {
      const created = await request(server())
        .post('/api/v1/prescriptions')
        .set('Authorization', auth(doctorPayload))
        .send({ consultationId: CONSULTATION_1 })
        .expect(201);
      const id = (created.body as { id: string }).id;
      await request(server())
        .post(`/api/v1/prescriptions/${id}/items`)
        .set('Authorization', auth(doctorPayload))
        .send({
          medicineId: MEDICINE_ACTIVE,
          dosage: '500mg',
          frequency: 'twice daily',
          duration: '5 days',
        })
        .expect(201);
      await request(server())
        .post(`/api/v1/prescriptions/${id}/finalize`)
        .set('Authorization', auth(doctorPayload))
        .expect(201);
      return id;
    }

    it('rejects minting a download token for a draft prescription', async () => {
      const created = await request(server())
        .post('/api/v1/prescriptions')
        .set('Authorization', auth(doctorPayload))
        .send({ consultationId: CONSULTATION_1 })
        .expect(201);
      const id = (created.body as { id: string }).id;

      const res = await request(server())
        .post(`/api/v1/prescriptions/${id}/download-token`)
        .set('Authorization', auth(doctorPayload));
      expect(res.status).toBe(403);
    });

    it('mints a token for a finalized prescription and downloads a PDF with it, unauthenticated', async () => {
      const id = await createFinalized();

      const tokenRes = await request(server())
        .post(`/api/v1/prescriptions/${id}/download-token`)
        .set('Authorization', auth(doctorPayload));
      expect(tokenRes.status).toBe(201);
      const { token } = tokenRes.body as { token: string };
      expect(typeof token).toBe('string');

      const pdfRes = await request(server()).get(`/api/v1/prescriptions/${id}/pdf?token=${token}`);
      expect(pdfRes.status).toBe(200);
      expect(pdfRes.headers['content-type']).toContain('application/pdf');
      expect((pdfRes.body as Buffer).length).toBeGreaterThan(0);
    });

    it('rejects a garbage/expired token', async () => {
      const id = await createFinalized();
      const res = await request(server()).get(`/api/v1/prescriptions/${id}/pdf?token=not-a-token`);
      expect(res.status).toBe(401);
    });

    it('rejects a token minted for a different prescription id (path/token mismatch)', async () => {
      const id = await createFinalized();

      const tokenRes = await request(server())
        .post(`/api/v1/prescriptions/${id}/download-token`)
        .set('Authorization', auth(doctorPayload));
      const { token } = tokenRes.body as { token: string };

      const res = await request(server()).get(
        `/api/v1/prescriptions/99999999-9999-4999-8999-999999999999/pdf?token=${token}`,
      );
      expect(res.status).toBe(401);
    });
  });
});
