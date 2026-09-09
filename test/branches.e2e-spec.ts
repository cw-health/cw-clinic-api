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
 * to end over HTTP for the branches module (Phase 1B), same shape as
 * doctors.e2e-spec.ts.
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
  permissions: ['branches:create', 'branches:read', 'branches:update', 'branches:archive'],
};

const adminBPayload: JwtPayload = {
  sub: 'user-admin-b',
  email: 'admin@clinic-b.test',
  role: 'ClinicAdmin',
  clinicId: CLINIC_B,
  clinicName: 'Clinic B',
  isSuperAdmin: false,
  permissions: ['branches:create', 'branches:read', 'branches:update', 'branches:archive'],
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

interface BranchRow {
  id: string;
  clinicId: string;
  name: string;
  code: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  timezone: string;
  status: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function makeFakePrisma() {
  const branches = new Map<string, BranchRow>();
  const branchInClinicA: BranchRow = {
    id: 'branch-1',
    clinicId: CLINIC_A,
    name: 'Main Branch',
    code: 'MAIN',
    phone: null,
    email: null,
    address: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
    timezone: 'UTC',
    status: 'ACTIVE',
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  branches.set(branchInClinicA.id, branchInClinicA);

  const fakePrisma = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    isHealthy: jest.fn().mockResolvedValue(true),
    clinic: { findUnique: jest.fn().mockResolvedValue({ timezone: 'UTC' }) },
    branch: {
      findFirst: jest.fn(
        ({ where }: { where: { id?: string; clinicId: string; code?: string; name?: string } }) => {
          if (where.id) {
            const branch = branches.get(where.id);
            if (!branch || branch.clinicId !== where.clinicId) return Promise.resolve(null);
            return Promise.resolve(branch);
          }
          const match = [...branches.values()].find(
            (b) =>
              b.clinicId === where.clinicId &&
              ((where.code && b.code === where.code) || (where.name && b.name === where.name)),
          );
          return Promise.resolve(match ?? null);
        },
      ),
      findMany: jest.fn(
        ({ where, skip, take }: { where: { clinicId: string }; skip: number; take: number }) => {
          const all = [...branches.values()].filter((b) => b.clinicId === where.clinicId);
          return Promise.resolve(all.slice(skip, skip + take));
        },
      ),
      count: jest.fn(({ where }: { where: { clinicId: string } }) =>
        Promise.resolve([...branches.values()].filter((b) => b.clinicId === where.clinicId).length),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const branch: BranchRow = {
          id: randomUUID(),
          clinicId: data.clinicId as string,
          name: data.name as string,
          code: data.code as string,
          phone: (data.phone as string) ?? null,
          email: (data.email as string) ?? null,
          address: (data.address as string) ?? null,
          city: (data.city as string) ?? null,
          state: (data.state as string) ?? null,
          postalCode: (data.postalCode as string) ?? null,
          country: (data.country as string) ?? null,
          timezone: (data.timezone as string) ?? 'UTC',
          status: 'ACTIVE',
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        branches.set(branch.id, branch);
        return Promise.resolve(branch);
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const branch = branches.get(where.id)!;
          Object.assign(branch, data);
          return Promise.resolve(branch);
        },
      ),
    },
  };

  (fakePrisma as Record<string, unknown>).$transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(fakePrisma);
  });

  return fakePrisma;
}

describe('Branches (e2e) — guard chain, tenant isolation, RBAC, archive', () => {
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
      const res = await request(server()).get('/api/v1/branches');
      expect(res.status).toBe(401);
    });
  });

  describe('permissions (RBAC)', () => {
    it('rejects a non-ClinicAdmin role creating a branch', async () => {
      const res = await request(server())
        .post('/api/v1/branches')
        .set('Authorization', auth(frontDeskNoAccessPayload))
        .send({ name: 'New Branch', code: 'NEW' });
      expect(res.status).toBe(403);
    });

    it('rejects a non-ClinicAdmin role listing branches', async () => {
      const res = await request(server())
        .get('/api/v1/branches')
        .set('Authorization', auth(frontDeskNoAccessPayload));
      expect(res.status).toBe(403);
    });

    it('rejects a non-ClinicAdmin role archiving a branch', async () => {
      const res = await request(server())
        .post('/api/v1/branches/branch-1/archive')
        .set('Authorization', auth(frontDeskNoAccessPayload));
      expect(res.status).toBe(403);
    });
  });

  describe('validation', () => {
    it('rejects a missing required field with 400', async () => {
      const res = await request(server())
        .post('/api/v1/branches')
        .set('Authorization', auth(adminAPayload))
        .send({ name: 'No Code' });
      expect(res.status).toBe(400);
    });

    it('rejects an unknown extra field (forbidNonWhitelisted), including client-supplied clinicId', async () => {
      const res = await request(server())
        .post('/api/v1/branches')
        .set('Authorization', auth(adminAPayload))
        .send({ name: 'X', code: 'X1', clinicId: 'clinic-b' });
      expect(res.status).toBe(400);
    });
  });

  describe('tenant isolation', () => {
    it("Clinic B's admin cannot read Clinic A's branch by id (404, not leaked)", async () => {
      const res = await request(server())
        .get('/api/v1/branches/branch-1')
        .set('Authorization', auth(adminBPayload));
      expect(res.status).toBe(404);
    });

    it("Clinic A's admin can read Clinic A's branch", async () => {
      const res = await request(server())
        .get('/api/v1/branches/branch-1')
        .set('Authorization', auth(adminAPayload));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'branch-1', clinicId: CLINIC_A });
    });

    it("Clinic B's admin cannot update Clinic A's branch (404, not leaked)", async () => {
      const res = await request(server())
        .patch('/api/v1/branches/branch-1')
        .set('Authorization', auth(adminBPayload))
        .send({ phone: '+1-555-0100' });
      expect(res.status).toBe(404);
    });

    it("Clinic B's admin cannot archive Clinic A's branch (404, not leaked)", async () => {
      const res = await request(server())
        .post('/api/v1/branches/branch-1/archive')
        .set('Authorization', auth(adminBPayload));
      expect(res.status).toBe(404);
    });

    it('Clinic B can create its own branch reusing the same code/name as Clinic A', async () => {
      const res = await request(server())
        .post('/api/v1/branches')
        .set('Authorization', auth(adminBPayload))
        .send({ name: 'Main Branch', code: 'MAIN' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ clinicId: CLINIC_B, code: 'MAIN' });
    });
  });

  describe('CRUD + pagination', () => {
    it('creates a branch scoped to the caller clinic', async () => {
      const res = await request(server())
        .post('/api/v1/branches')
        .set('Authorization', auth(adminAPayload))
        .send({ name: 'Downtown Branch', code: 'DOWNTOWN' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ clinicId: CLINIC_A, code: 'DOWNTOWN', status: 'ACTIVE' });
    });

    it('rejects a duplicate branch code within the same clinic (409)', async () => {
      const res = await request(server())
        .post('/api/v1/branches')
        .set('Authorization', auth(adminAPayload))
        .send({ name: 'Another Name', code: 'MAIN' });
      expect(res.status).toBe(409);
    });

    it('rejects a duplicate branch name within the same clinic (409)', async () => {
      const res = await request(server())
        .post('/api/v1/branches')
        .set('Authorization', auth(adminAPayload))
        .send({ name: 'Main Branch', code: 'ANOTHER-CODE' });
      expect(res.status).toBe(409);
    });

    it('lists branches with the { data, meta: { total, page, pageSize } } envelope', async () => {
      const res = await request(server())
        .get('/api/v1/branches?page=1&pageSize=1')
        .set('Authorization', auth(adminAPayload));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        data: expect.any(Array) as unknown[],
        meta: { page: 1, pageSize: 1, total: expect.any(Number) as number },
      });
    });

    it('updates a branch', async () => {
      const res = await request(server())
        .patch('/api/v1/branches/branch-1')
        .set('Authorization', auth(adminAPayload))
        .send({ phone: '+1-555-0199' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'branch-1', phone: '+1-555-0199' });
    });

    it('rejects an out-of-range pageSize', async () => {
      const res = await request(server())
        .get('/api/v1/branches?pageSize=1000')
        .set('Authorization', auth(adminAPayload));
      expect(res.status).toBe(400);
    });
  });

  describe('archive behavior', () => {
    it('archives a branch', async () => {
      const res = await request(server())
        .post('/api/v1/branches/branch-1/archive')
        .set('Authorization', auth(adminAPayload));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: 'branch-1', status: 'ARCHIVED' });
    });

    it('rejects archiving an already-archived branch (409)', async () => {
      const res = await request(server())
        .post('/api/v1/branches/branch-1/archive')
        .set('Authorization', auth(adminAPayload));
      expect(res.status).toBe(409);
    });

    it('rejects updating an archived branch (409)', async () => {
      const res = await request(server())
        .patch('/api/v1/branches/branch-1')
        .set('Authorization', auth(adminAPayload))
        .send({ phone: '+1-555-0200' });
      expect(res.status).toBe(409);
    });

    it('rejects changing status on an archived branch (409)', async () => {
      const res = await request(server())
        .patch('/api/v1/branches/branch-1/status')
        .set('Authorization', auth(adminAPayload))
        .send({ status: 'INACTIVE' });
      expect(res.status).toBe(409);
    });
  });
});
