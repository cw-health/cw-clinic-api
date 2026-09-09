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
 * Exercises the real AuthGuard -> TenantGuard -> PermissionsGuard chain end
 * to end over HTTP for the doctors module (the Phase 4 representative case
 * — patients/clinic-settings follow the identical clinicId-scoping
 * pattern, unit-tested at the service layer instead). JwtStrategy only
 * decodes the token (no DB round trip, see jwt.strategy.ts), so tokens are
 * signed directly here rather than going through a fake login flow.
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
  permissions: ['doctors:create', 'doctors:read', 'doctors:update'],
};

const adminBPayload: JwtPayload = {
  sub: 'user-admin-b',
  email: 'admin@clinic-b.test',
  role: 'ClinicAdmin',
  clinicId: CLINIC_B,
  clinicName: 'Clinic B',
  isSuperAdmin: false,
  permissions: ['doctors:create', 'doctors:read', 'doctors:update'],
};

const doctorSelfPayload: JwtPayload = {
  sub: 'user-doc-1',
  email: 'doc1@clinic-a.test',
  role: 'Doctor',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['doctors:read-own', 'doctors:update-own'],
};

const frontDeskNoAccessPayload: JwtPayload = {
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
  phone: string | null;
  licenseNumber: string | null;
  qualification: string | null;
  bio: string | null;
  consultationFee: string | null;
  yearsOfExperience: number | null;
  status: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; email: string; firstName: string; lastName: string };
  specializations: never[];
  departments: never[];
}

function makeFakePrisma() {
  const doctors = new Map<string, DoctorRow>();
  const doctorInClinicA: DoctorRow = {
    id: 'doctor-1',
    clinicId: CLINIC_A,
    userId: doctorSelfPayload.sub,
    phone: null,
    licenseNumber: null,
    qualification: null,
    bio: null,
    consultationFee: null,
    yearsOfExperience: null,
    status: 'ACTIVE',
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {
      id: doctorSelfPayload.sub,
      email: doctorSelfPayload.email,
      firstName: 'Ada',
      lastName: 'Lovelace',
    },
    specializations: [],
    departments: [],
  };
  doctors.set(doctorInClinicA.id, doctorInClinicA);

  const fakePrisma = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    isHealthy: jest.fn().mockResolvedValue(true),
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: randomUUID(), ...data }),
      ),
    },
    role: {
      findFirst: jest.fn().mockResolvedValue({ id: 'role-doctor', name: 'Doctor' }),
    },
    clinicMembership: { create: jest.fn().mockResolvedValue({}) },
    specialization: { count: jest.fn().mockResolvedValue(0) },
    department: { count: jest.fn().mockResolvedValue(0) },
    doctorDepartment: { deleteMany: jest.fn(), createMany: jest.fn() },
    doctor: {
      findFirst: jest.fn(
        ({ where }: { where: { id?: string; clinicId: string; userId?: string } }) => {
          if (where.userId) {
            const match = [...doctors.values()].find(
              (d) => d.userId === where.userId && d.clinicId === where.clinicId,
            );
            return Promise.resolve(match ?? null);
          }
          const doctor = doctors.get(where.id!);
          if (!doctor || doctor.clinicId !== where.clinicId) return Promise.resolve(null);
          return Promise.resolve(doctor);
        },
      ),
      findMany: jest.fn(
        ({ where, skip, take }: { where: { clinicId: string }; skip: number; take: number }) => {
          const all = [...doctors.values()].filter((d) => d.clinicId === where.clinicId);
          return Promise.resolve(all.slice(skip, skip + take));
        },
      ),
      count: jest.fn(({ where }: { where: { clinicId: string } }) =>
        Promise.resolve([...doctors.values()].filter((d) => d.clinicId === where.clinicId).length),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const doctor: DoctorRow = {
          id: randomUUID(),
          clinicId: data.clinicId as string,
          userId: data.userId as string,
          phone: (data.phone as string) ?? null,
          licenseNumber: (data.licenseNumber as string) ?? null,
          qualification: (data.qualification as string) ?? null,
          bio: (data.bio as string) ?? null,
          consultationFee: null,
          yearsOfExperience: (data.yearsOfExperience as number) ?? null,
          status: 'ACTIVE',
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          user: {
            id: data.userId as string,
            email: 'new@clinic-a.test',
            firstName: 'New',
            lastName: 'Doc',
          },
          specializations: [],
          departments: [],
        };
        doctors.set(doctor.id, doctor);
        return Promise.resolve(doctor);
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const doctor = doctors.get(where.id)!;
          Object.assign(doctor, data);
          return Promise.resolve(doctor);
        },
      ),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string; clinicId: string };
          data: Record<string, unknown>;
        }) => {
          const doctor = doctors.get(where.id);
          if (!doctor || doctor.clinicId !== where.clinicId) return Promise.resolve({ count: 0 });
          Object.assign(doctor, data);
          return Promise.resolve({ count: 1 });
        },
      ),
      findFirstOrThrow: jest.fn(({ where }: { where: { id: string } }) => {
        const doctor = doctors.get(where.id);
        if (!doctor) throw new Error('Doctor not found');
        return Promise.resolve(doctor);
      }),
    },
    doctorSpecialization: { deleteMany: jest.fn(), createMany: jest.fn() },
    doctorAvailability: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  };

  (fakePrisma as Record<string, unknown>).$transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(fakePrisma);
  });

  return fakePrisma;
}

describe('Doctors (e2e) — guard chain, tenant isolation, pagination, validation', () => {
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

  describe('authentication', () => {
    it('rejects with no token', async () => {
      const res = await request(server()).get('/api/v1/doctors');
      expect(res.status).toBe(401);
    });
  });

  describe('permissions', () => {
    it('rejects a role without doctors:create when creating a doctor', async () => {
      const res = await request(server())
        .post('/api/v1/doctors')
        .set('Authorization', auth(frontDeskNoAccessPayload))
        .send({
          email: 'x@test.com',
          firstName: 'X',
          lastName: 'Y',
          temporaryPassword: 'Password123!',
        });
      expect(res.status).toBe(403);
    });

    it('rejects a Doctor updating another doctor via the admin-only :id route', async () => {
      const res = await request(server())
        .patch('/api/v1/doctors/doctor-1')
        .set('Authorization', auth(doctorSelfPayload))
        .send({ bio: 'hacked' });
      expect(res.status).toBe(403);
    });
  });

  describe('validation', () => {
    it('rejects an invalid payload (missing required fields) with 400', async () => {
      const res = await request(server())
        .post('/api/v1/doctors')
        .set('Authorization', auth(adminAPayload))
        .send({ email: 'not-an-email' });
      expect(res.status).toBe(400);
    });

    it('rejects an unknown extra field (forbidNonWhitelisted)', async () => {
      const res = await request(server())
        .post('/api/v1/doctors')
        .set('Authorization', auth(adminAPayload))
        .send({
          email: 'x@test.com',
          firstName: 'X',
          lastName: 'Y',
          temporaryPassword: 'Password123!',
          clinicId: 'clinic-b', // clinicId must never be accepted from the client
        });
      expect(res.status).toBe(400);
    });
  });

  describe('tenant isolation', () => {
    it("Clinic B's admin cannot read Clinic A's doctor by id (404, not leaked)", async () => {
      const res = await request(server())
        .get('/api/v1/doctors/doctor-1')
        .set('Authorization', auth(adminBPayload));
      expect(res.status).toBe(404);
    });

    it("Clinic A's admin can read Clinic A's doctor", async () => {
      const res = await request(server())
        .get('/api/v1/doctors/doctor-1')
        .set('Authorization', auth(adminAPayload));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'doctor-1', clinicId: CLINIC_A });
    });

    it("Clinic B's admin cannot update Clinic A's doctor (404, not leaked)", async () => {
      const res = await request(server())
        .patch('/api/v1/doctors/doctor-1')
        .set('Authorization', auth(adminBPayload))
        .send({ bio: 'cross-tenant write attempt' });
      expect(res.status).toBe(404);
    });
  });

  describe('self-service', () => {
    it('a Doctor can read their own profile via /doctors/me', async () => {
      const res = await request(server())
        .get('/api/v1/doctors/me')
        .set('Authorization', auth(doctorSelfPayload));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'doctor-1', userId: doctorSelfPayload.sub });
    });
  });

  describe('CRUD + pagination', () => {
    it('creates a doctor scoped to the caller clinic', async () => {
      const res = await request(server())
        .post('/api/v1/doctors')
        .set('Authorization', auth(adminAPayload))
        .send({
          email: 'newdoc@clinic-a.test',
          firstName: 'New',
          lastName: 'Doc',
          temporaryPassword: 'Password123!',
        });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ clinicId: CLINIC_A });
    });

    it('lists doctors with the { data, meta: { total, page, pageSize } } envelope', async () => {
      const res = await request(server())
        .get('/api/v1/doctors?page=1&pageSize=1')
        .set('Authorization', auth(adminAPayload));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        data: expect.any(Array) as unknown[],
        meta: { page: 1, pageSize: 1, total: expect.any(Number) as number },
      });
      expect((res.body as { data: unknown[] }).data.length).toBeLessThanOrEqual(1);
    });

    it('rejects an out-of-range pageSize', async () => {
      const res = await request(server())
        .get('/api/v1/doctors?pageSize=1000')
        .set('Authorization', auth(adminAPayload));
      expect(res.status).toBe(400);
    });
  });
});
