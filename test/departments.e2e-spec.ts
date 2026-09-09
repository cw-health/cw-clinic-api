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
 * to end over HTTP for the departments module (Phase 1C), same shape as
 * branches.e2e-spec.ts. Departments sit under a Branch (Clinic -> Branch ->
 * Department), so the fake Prisma layer here also fakes `branch` and
 * `doctor` lookups that DepartmentsService validates against.
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
    'departments:create',
    'departments:read',
    'departments:update',
    'departments:archive',
  ],
};

const adminBPayload: JwtPayload = {
  sub: 'user-admin-b',
  email: 'admin@clinic-b.test',
  role: 'ClinicAdmin',
  clinicId: CLINIC_B,
  clinicName: 'Clinic B',
  isSuperAdmin: false,
  permissions: [
    'departments:create',
    'departments:read',
    'departments:update',
    'departments:archive',
  ],
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
  status: string;
  deletedAt: Date | null;
}

interface DoctorRow {
  id: string;
  clinicId: string;
  deletedAt: Date | null;
}

interface DepartmentRow {
  id: string;
  clinicId: string;
  branchId: string;
  name: string;
  code: string;
  description: string | null;
  status: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function makeFakePrisma() {
  const branches = new Map<string, BranchRow>();
  branches.set('branch-1', {
    id: 'branch-1',
    clinicId: CLINIC_A,
    name: 'Main Branch',
    code: 'MAIN',
    status: 'ACTIVE',
    deletedAt: null,
  });
  branches.set('branch-2', {
    id: 'branch-2',
    clinicId: CLINIC_B,
    name: 'Other Main',
    code: 'MAIN',
    status: 'ACTIVE',
    deletedAt: null,
  });

  const doctors = new Map<string, DoctorRow>();
  doctors.set('doctor-1', { id: 'doctor-1', clinicId: CLINIC_A, deletedAt: null });

  const departments = new Map<string, DepartmentRow>();
  departments.set('dept-1', {
    id: 'dept-1',
    clinicId: CLINIC_A,
    branchId: 'branch-1',
    name: 'Cardiology',
    code: 'CARDIO',
    description: null,
    status: 'ACTIVE',
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const doctorDepartments = new Map<string, { doctorId: string; departmentId: string }>();

  const withRelations = (d: DepartmentRow) => {
    const branch = branches.get(d.branchId) ?? null;
    return {
      ...d,
      branch: branch ? { id: branch.id, name: branch.name, code: branch.code } : null,
      doctors: [...doctorDepartments.values()]
        .filter((dd) => dd.departmentId === d.id)
        .map((dd) => ({ doctorId: dd.doctorId })),
    };
  };

  const fakePrisma = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    isHealthy: jest.fn().mockResolvedValue(true),
    branch: {
      findFirst: jest.fn(({ where }: { where: { id: string; clinicId: string } }) => {
        const branch = branches.get(where.id);
        if (!branch || branch.clinicId !== where.clinicId || branch.deletedAt) {
          return Promise.resolve(null);
        }
        return Promise.resolve(branch);
      }),
    },
    doctor: {
      count: jest.fn(({ where }: { where: { id: { in: string[] }; clinicId: string } }) => {
        const matching = where.id.in.filter((id) => {
          const doctor = doctors.get(id);
          return doctor && doctor.clinicId === where.clinicId && !doctor.deletedAt;
        });
        return Promise.resolve(matching.length);
      }),
    },
    department: {
      findFirst: jest.fn(
        ({
          where,
        }: {
          where: {
            id?: string;
            clinicId: string;
            branchId?: string;
            code?: string;
            name?: string;
            deletedAt?: null;
            id_not?: { not: string };
          };
        }) => {
          if (where.id) {
            const dept = departments.get(where.id);
            if (!dept || dept.clinicId !== where.clinicId || dept.deletedAt) {
              return Promise.resolve(null);
            }
            return Promise.resolve(withRelations(dept));
          }
          const match = [...departments.values()].find(
            (d) =>
              d.branchId === where.branchId &&
              !d.deletedAt &&
              ((where.code && d.code === where.code) || (where.name && d.name === where.name)),
          );
          return Promise.resolve(match ? withRelations(match) : null);
        },
      ),
      findMany: jest.fn(
        ({
          where,
          skip,
          take,
        }: {
          where: { clinicId: string; branchId?: string };
          skip: number;
          take: number;
        }) => {
          const all = [...departments.values()].filter(
            (d) =>
              d.clinicId === where.clinicId &&
              !d.deletedAt &&
              (!where.branchId || d.branchId === where.branchId),
          );
          return Promise.resolve(all.slice(skip, skip + take).map(withRelations));
        },
      ),
      count: jest.fn(({ where }: { where: { clinicId: string } }) =>
        Promise.resolve(
          [...departments.values()].filter((d) => d.clinicId === where.clinicId && !d.deletedAt)
            .length,
        ),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const dept: DepartmentRow = {
          id: randomUUID(),
          clinicId: data.clinicId as string,
          branchId: data.branchId as string,
          name: data.name as string,
          code: data.code as string,
          description: (data.description as string) ?? null,
          status: 'ACTIVE',
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        departments.set(dept.id, dept);
        const doctorsCreate = (data.doctors as { create?: { doctorId: string }[] } | undefined)
          ?.create;
        if (doctorsCreate) {
          for (const { doctorId } of doctorsCreate) {
            doctorDepartments.set(`${doctorId}:${dept.id}`, { doctorId, departmentId: dept.id });
          }
        }
        return Promise.resolve(withRelations(dept));
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const dept = departments.get(where.id)!;
          Object.assign(dept, data);
          return Promise.resolve(withRelations(dept));
        },
      ),
    },
    doctorDepartment: {
      deleteMany: jest.fn(({ where }: { where: { departmentId: string } }) => {
        for (const [key, dd] of doctorDepartments) {
          if (dd.departmentId === where.departmentId) doctorDepartments.delete(key);
        }
        return Promise.resolve({ count: 0 });
      }),
      createMany: jest.fn(({ data }: { data: { doctorId: string; departmentId: string }[] }) => {
        for (const dd of data) doctorDepartments.set(`${dd.doctorId}:${dd.departmentId}`, dd);
        return Promise.resolve({ count: data.length });
      }),
    },
  };

  (fakePrisma as Record<string, unknown>).$transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(fakePrisma);
  });

  return fakePrisma;
}

describe('Departments (e2e) — guard chain, tenant isolation, RBAC, archive', () => {
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
      const res = await request(server()).get('/api/v1/departments');
      expect(res.status).toBe(401);
    });
  });

  describe('permissions (RBAC)', () => {
    it('rejects a non-ClinicAdmin role creating a department', async () => {
      const res = await request(server())
        .post('/api/v1/departments')
        .set('Authorization', auth(frontDeskNoAccessPayload))
        .send({ branchId: 'branch-1', name: 'OPD', code: 'OPD' });
      expect(res.status).toBe(403);
    });

    it('rejects a non-ClinicAdmin role listing departments', async () => {
      const res = await request(server())
        .get('/api/v1/departments')
        .set('Authorization', auth(frontDeskNoAccessPayload));
      expect(res.status).toBe(403);
    });

    it('rejects a non-ClinicAdmin role archiving a department', async () => {
      const res = await request(server())
        .post('/api/v1/departments/dept-1/archive')
        .set('Authorization', auth(frontDeskNoAccessPayload));
      expect(res.status).toBe(403);
    });
  });

  describe('validation', () => {
    it('rejects a missing required field with 400', async () => {
      const res = await request(server())
        .post('/api/v1/departments')
        .set('Authorization', auth(adminAPayload))
        .send({ name: 'No Code Or Branch' });
      expect(res.status).toBe(400);
    });

    it('rejects an unknown extra field (forbidNonWhitelisted), including client-supplied clinicId', async () => {
      const res = await request(server())
        .post('/api/v1/departments')
        .set('Authorization', auth(adminAPayload))
        .send({ branchId: 'branch-1', name: 'X', code: 'X1', clinicId: 'clinic-b' });
      expect(res.status).toBe(400);
    });
  });

  describe('branch ownership', () => {
    it("rejects creating a department under another clinic's branch (400, not leaked as 404)", async () => {
      const res = await request(server())
        .post('/api/v1/departments')
        .set('Authorization', auth(adminAPayload))
        .send({ branchId: 'branch-2', name: 'Foreign Branch Dept', code: 'FBD' });
      expect(res.status).toBe(400);
    });

    it('creates a department under the caller clinic own branch', async () => {
      const res = await request(server())
        .post('/api/v1/departments')
        .set('Authorization', auth(adminAPayload))
        .send({ branchId: 'branch-1', name: 'OPD', code: 'OPD' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        clinicId: CLINIC_A,
        branchId: 'branch-1',
        branch: { id: 'branch-1', name: 'Main Branch', code: 'MAIN' },
      });
    });
  });

  describe('existing doctor compatibility', () => {
    it('rejects a doctorId that does not belong to the caller clinic', async () => {
      const res = await request(server())
        .post('/api/v1/departments')
        .set('Authorization', auth(adminAPayload))
        .send({
          branchId: 'branch-1',
          name: 'Radiology',
          code: 'RADIO',
          doctorIds: ['doctor-does-not-exist'],
        });
      expect(res.status).toBe(400);
    });

    it('assigns an existing clinic doctor to a new department', async () => {
      const res = await request(server())
        .post('/api/v1/departments')
        .set('Authorization', auth(adminAPayload))
        .send({
          branchId: 'branch-1',
          name: 'Pediatrics',
          code: 'PEDS',
          doctorIds: ['doctor-1'],
        });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ doctorIds: ['doctor-1'] });
    });
  });

  describe('tenant isolation', () => {
    it("Clinic B's admin cannot read Clinic A's department by id (404, not leaked)", async () => {
      const res = await request(server())
        .get('/api/v1/departments/dept-1')
        .set('Authorization', auth(adminBPayload));
      expect(res.status).toBe(404);
    });

    it("Clinic A's admin can read Clinic A's department", async () => {
      const res = await request(server())
        .get('/api/v1/departments/dept-1')
        .set('Authorization', auth(adminAPayload));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'dept-1', clinicId: CLINIC_A });
    });

    it("Clinic B's admin cannot update Clinic A's department (404, not leaked)", async () => {
      const res = await request(server())
        .patch('/api/v1/departments/dept-1')
        .set('Authorization', auth(adminBPayload))
        .send({ description: 'hijacked' });
      expect(res.status).toBe(404);
    });

    it("Clinic B's admin cannot archive Clinic A's department (404, not leaked)", async () => {
      const res = await request(server())
        .post('/api/v1/departments/dept-1/archive')
        .set('Authorization', auth(adminBPayload));
      expect(res.status).toBe(404);
    });

    it('Clinic B can create its own department reusing the same code/name as Clinic A', async () => {
      const res = await request(server())
        .post('/api/v1/departments')
        .set('Authorization', auth(adminBPayload))
        .send({ branchId: 'branch-2', name: 'Cardiology', code: 'CARDIO' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ clinicId: CLINIC_B, code: 'CARDIO' });
    });
  });

  describe('CRUD + pagination + duplicate names/codes', () => {
    it('rejects a duplicate department code within the same branch (409)', async () => {
      const res = await request(server())
        .post('/api/v1/departments')
        .set('Authorization', auth(adminAPayload))
        .send({ branchId: 'branch-1', name: 'Another Name', code: 'CARDIO' });
      expect(res.status).toBe(409);
    });

    it('rejects a duplicate department name within the same branch (409)', async () => {
      const res = await request(server())
        .post('/api/v1/departments')
        .set('Authorization', auth(adminAPayload))
        .send({ branchId: 'branch-1', name: 'Cardiology', code: 'ANOTHER-CODE' });
      expect(res.status).toBe(409);
    });

    it('lists departments with the { data, meta: { total, page, pageSize } } envelope', async () => {
      const res = await request(server())
        .get('/api/v1/departments?page=1&pageSize=1')
        .set('Authorization', auth(adminAPayload));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        data: expect.any(Array) as unknown[],
        meta: { page: 1, pageSize: 1, total: expect.any(Number) as number },
      });
    });

    it('updates a department', async () => {
      const res = await request(server())
        .patch('/api/v1/departments/dept-1')
        .set('Authorization', auth(adminAPayload))
        .send({ description: 'Heart & vascular care' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'dept-1', description: 'Heart & vascular care' });
    });

    it('rejects an out-of-range pageSize', async () => {
      const res = await request(server())
        .get('/api/v1/departments?pageSize=1000')
        .set('Authorization', auth(adminAPayload));
      expect(res.status).toBe(400);
    });
  });

  describe('archive behavior', () => {
    it('archives a department', async () => {
      const res = await request(server())
        .post('/api/v1/departments/dept-1/archive')
        .set('Authorization', auth(adminAPayload));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: 'dept-1', status: 'ARCHIVED' });
    });

    it('rejects archiving an already-archived department (409)', async () => {
      const res = await request(server())
        .post('/api/v1/departments/dept-1/archive')
        .set('Authorization', auth(adminAPayload));
      expect(res.status).toBe(409);
    });

    it('rejects updating an archived department (409)', async () => {
      const res = await request(server())
        .patch('/api/v1/departments/dept-1')
        .set('Authorization', auth(adminAPayload))
        .send({ description: 'still trying' });
      expect(res.status).toBe(409);
    });

    it('rejects changing status on an archived department (409)', async () => {
      const res = await request(server())
        .patch('/api/v1/departments/dept-1/status')
        .set('Authorization', auth(adminAPayload))
        .send({ status: 'INACTIVE' });
      expect(res.status).toBe(409);
    });
  });
});
