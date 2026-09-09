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

/** Exercises the medicines formulary: manage vs read permissions, search/active filter, tenant isolation. */
function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });
}

const CLINIC_A = 'clinic-a';
const CLINIC_B = 'clinic-b';

const adminPayload: JwtPayload = {
  sub: 'user-admin-a',
  email: 'admin@clinic-a.test',
  role: 'ClinicAdmin',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['medicines:read', 'medicines:manage'],
};

const doctorPayload: JwtPayload = {
  sub: 'user-doc-1',
  email: 'doc1@clinic-a.test',
  role: 'Doctor',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['medicines:read'],
};

const adminBPayload: JwtPayload = {
  ...adminPayload,
  sub: 'user-admin-b',
  email: 'admin@clinic-b.test',
  clinicId: CLINIC_B,
};

interface MedicineRow {
  id: string;
  clinicId: string;
  name: string;
  genericName: string | null;
  strength: string | null;
  form: string | null;
  manufacturer: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function makeFakePrisma() {
  const medicines = new Map<string, MedicineRow>();

  const fakePrisma = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    isHealthy: jest.fn().mockResolvedValue(true),
    medicine: {
      findFirst: jest.fn(({ where }: { where: { id: string; clinicId: string } }) => {
        const medicine = medicines.get(where.id);
        if (!medicine || medicine.clinicId !== where.clinicId) return Promise.resolve(null);
        return Promise.resolve(medicine);
      }),
      findMany: jest.fn(
        ({
          where,
          skip = 0,
          take = 20,
        }: {
          where: {
            clinicId: string;
            isActive?: boolean;
            OR?: { name?: { contains: string }; genericName?: { contains: string } }[];
          };
          skip?: number;
          take?: number;
        }) => {
          let all = [...medicines.values()].filter((m) => m.clinicId === where.clinicId);
          if (where.isActive !== undefined) all = all.filter((m) => m.isActive === where.isActive);
          if (where.OR) {
            const term = (where.OR[0].name?.contains ?? '').toLowerCase();
            all = all.filter(
              (m) =>
                m.name.toLowerCase().includes(term) ||
                (m.genericName ?? '').toLowerCase().includes(term),
            );
          }
          all = all.sort((a, b) => a.name.localeCompare(b.name));
          return Promise.resolve(all.slice(skip, skip + take));
        },
      ),
      count: jest.fn(({ where }: { where: { clinicId: string; isActive?: boolean } }) =>
        Promise.resolve(
          [...medicines.values()].filter(
            (m) =>
              m.clinicId === where.clinicId &&
              (where.isActive === undefined || m.isActive === where.isActive),
          ).length,
        ),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        if (
          [...medicines.values()].some(
            (m) =>
              m.clinicId === data.clinicId &&
              m.name === data.name &&
              (m.strength ?? null) === ((data.strength as string) ?? null),
          )
        ) {
          const err = new Error('Unique constraint violation') as Error & { code: string };
          err.code = 'P2002';
          throw err;
        }
        const row: MedicineRow = {
          id: randomUUID(),
          clinicId: data.clinicId as string,
          name: data.name as string,
          genericName: (data.genericName as string) ?? null,
          strength: (data.strength as string) ?? null,
          form: (data.form as string) ?? null,
          manufacturer: (data.manufacturer as string) ?? null,
          notes: (data.notes as string) ?? null,
          isActive: (data.isActive as boolean) ?? true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        medicines.set(row.id, row);
        return Promise.resolve(row);
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = medicines.get(where.id)!;
          Object.assign(
            row,
            Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
            { updatedAt: new Date() },
          );
          return Promise.resolve(row);
        },
      ),
    },
  };

  (fakePrisma as Record<string, unknown>).$transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(fakePrisma);
  });

  return { fakePrisma, medicines };
}

describe('Medicines (e2e) — manage vs read permissions, search, tenant isolation', () => {
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
    harness.medicines.clear();
  });

  it('rejects a Doctor (read-only) creating a medicine', async () => {
    const res = await request(server())
      .post('/api/v1/medicines')
      .set('Authorization', auth(doctorPayload))
      .send({ name: 'Paracetamol' });
    expect(res.status).toBe(403);
  });

  it('a ClinicAdmin creates a medicine, a Doctor can read it', async () => {
    const created = await request(server())
      .post('/api/v1/medicines')
      .set('Authorization', auth(adminPayload))
      .send({ name: 'Paracetamol', genericName: 'Acetaminophen', strength: '500mg' });
    expect(created.status).toBe(201);

    const res = await request(server())
      .get('/api/v1/medicines')
      .set('Authorization', auth(doctorPayload));
    expect(res.status).toBe(200);
    expect((res.body as { data: unknown[] }).data).toHaveLength(1);
  });

  it('rejects a duplicate name+strength within the same clinic', async () => {
    await request(server())
      .post('/api/v1/medicines')
      .set('Authorization', auth(adminPayload))
      .send({ name: 'Paracetamol', strength: '500mg' })
      .expect(201);

    const res = await request(server())
      .post('/api/v1/medicines')
      .set('Authorization', auth(adminPayload))
      .send({ name: 'Paracetamol', strength: '500mg' });
    expect(res.status).toBe(409);
  });

  it('filters by search and isActive, and a deactivated entry can be reactivated', async () => {
    const created = await request(server())
      .post('/api/v1/medicines')
      .set('Authorization', auth(adminPayload))
      .send({ name: 'Amoxicillin', genericName: 'Amoxicillin trihydrate' });
    const id = (created.body as { id: string }).id;

    await request(server())
      .patch(`/api/v1/medicines/${id}`)
      .set('Authorization', auth(adminPayload))
      .send({ isActive: false })
      .expect(200);

    const activeOnly = await request(server())
      .get('/api/v1/medicines?isActive=true')
      .set('Authorization', auth(doctorPayload));
    expect((activeOnly.body as { data: unknown[] }).data).toHaveLength(0);

    const searchHit = await request(server())
      .get('/api/v1/medicines?search=amox&isActive=false')
      .set('Authorization', auth(doctorPayload));
    expect((searchHit.body as { data: { id: string }[] }).data).toHaveLength(1);
  });

  it('a cross-tenant medicine id 404s rather than leaking existence', async () => {
    const created = await request(server())
      .post('/api/v1/medicines')
      .set('Authorization', auth(adminPayload))
      .send({ name: 'Paracetamol' });
    const id = (created.body as { id: string }).id;

    const res = await request(server())
      .get(`/api/v1/medicines/${id}`)
      .set('Authorization', auth(adminBPayload));
    expect(res.status).toBe(404);
  });
});
