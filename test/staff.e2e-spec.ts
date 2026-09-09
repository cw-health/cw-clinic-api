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
 * to end over HTTP for the staff module (Phase 1D), same shape as
 * departments.e2e-spec.ts. Covers: tenant isolation, permission
 * enforcement, role assignment (incl. SuperAdmin/Patient rejection), branch
 * assignment, inactive-user behavior, Super Admin protection, and
 * duplicate-email handling — the checklist in the task brief.
 */
function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });
}

const CLINIC_A = 'clinic-a';
const CLINIC_B = 'clinic-b';

// CreateStaffDto/AssignStaffRoleDto/AssignStaffBranchDto validate roleId/
// branchId with @IsUUID() — the fixture ids below must be real UUID shapes
// (path :id params are plain strings, so membership/user ids don't need to be).
const ROLE_SUPERADMIN = '11111111-1111-4111-8111-111111111111';
const ROLE_PATIENT = '22222222-2222-4222-8222-222222222222';
const ROLE_CLINICADMIN = '33333333-3333-4333-8333-333333333333';
const ROLE_NURSE = '44444444-4444-4444-8444-444444444444';
const ROLE_DOES_NOT_EXIST = '55555555-5555-4555-8555-555555555555';
const BRANCH_1 = '66666666-6666-4666-8666-666666666666';
const BRANCH_2 = '77777777-7777-4777-8777-777777777777';

const adminAPayload: JwtPayload = {
  sub: 'user-admin-a',
  email: 'admin@clinic-a.test',
  role: 'ClinicAdmin',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['users:create', 'users:read', 'users:update', 'users:delete'],
};

const adminBPayload: JwtPayload = {
  sub: 'user-admin-b',
  email: 'admin@clinic-b.test',
  role: 'ClinicAdmin',
  clinicId: CLINIC_B,
  clinicName: 'Clinic B',
  isSuperAdmin: false,
  permissions: ['users:create', 'users:read', 'users:update', 'users:delete'],
};

const nurseNoAccessPayload: JwtPayload = {
  sub: 'user-nurse-1',
  email: 'nurse1@clinic-a.test',
  role: 'Nurse',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['patients:read'],
};

interface RoleRow {
  id: string;
  clinicId: string | null;
  isSystem: boolean;
  name: string;
  description: string | null;
  status: string;
}

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  isSuperAdmin: boolean;
}

interface MembershipRow {
  id: string;
  userId: string;
  clinicId: string;
  roleId: string;
  branchId: string | null;
  departmentId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

function makeFakePrisma() {
  const roles = new Map<string, RoleRow>();
  roles.set(ROLE_SUPERADMIN, {
    id: ROLE_SUPERADMIN,
    clinicId: null,
    isSystem: true,
    name: 'SuperAdmin',
    description: null,
    status: 'ACTIVE',
  });
  roles.set(ROLE_PATIENT, {
    id: ROLE_PATIENT,
    clinicId: null,
    isSystem: true,
    name: 'Patient',
    description: null,
    status: 'ACTIVE',
  });
  roles.set(ROLE_CLINICADMIN, {
    id: ROLE_CLINICADMIN,
    clinicId: null,
    isSystem: true,
    name: 'ClinicAdmin',
    description: 'Full administrative access',
    status: 'ACTIVE',
  });
  roles.set(ROLE_NURSE, {
    id: ROLE_NURSE,
    clinicId: null,
    isSystem: true,
    name: 'Nurse',
    description: 'Clinical support staff',
    status: 'ACTIVE',
  });

  const branches = new Map<string, { id: string; clinicId: string; deletedAt: null }>();
  branches.set(BRANCH_1, { id: BRANCH_1, clinicId: CLINIC_A, deletedAt: null });
  branches.set(BRANCH_2, { id: BRANCH_2, clinicId: CLINIC_B, deletedAt: null });

  const users = new Map<string, UserRow>();
  users.set('user-existing-a', {
    id: 'user-existing-a',
    email: 'existing@clinic-a.test',
    firstName: 'Existing',
    lastName: 'Staff',
    status: 'ACTIVE',
    isSuperAdmin: false,
  });

  const memberships = new Map<string, MembershipRow>();
  memberships.set('membership-a1', {
    id: 'membership-a1',
    userId: 'user-existing-a',
    clinicId: CLINIC_A,
    roleId: ROLE_NURSE,
    branchId: null,
    departmentId: null,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const invitations = new Map<string, { userId: string; tokenHash: string }>();

  const withRelations = (m: MembershipRow) => {
    const user = users.get(m.userId)!;
    const role = roles.get(m.roleId)!;
    const branch = m.branchId ? (branches.get(m.branchId) ?? null) : null;
    return {
      ...m,
      user: { ...user, staffInvitation: invitations.has(user.id) ? { acceptedAt: null } : null },
      role,
      branch: branch ? { id: branch.id, name: 'Branch', code: 'BR' } : null,
      department: null,
    };
  };

  const fakePrisma = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    isHealthy: jest.fn().mockResolvedValue(true),
    user: {
      findUnique: jest.fn(({ where }: { where: { id?: string; email?: string } }) => {
        if (where.id) return Promise.resolve(users.get(where.id) ?? null);
        const match = [...users.values()].find((u) => u.email === where.email);
        return Promise.resolve(match ?? null);
      }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const user: UserRow = {
          id: randomUUID(),
          email: data.email as string,
          firstName: data.firstName as string,
          lastName: data.lastName as string,
          status: data.status as string,
          isSuperAdmin: false,
        };
        users.set(user.id, user);
        return Promise.resolve(user);
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const user = users.get(where.id)!;
          Object.assign(user, data);
          return Promise.resolve(user);
        },
      ),
    },
    role: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(roles.get(where.id) ?? null),
      ),
      findMany: jest.fn(() =>
        Promise.resolve(
          [...roles.values()].filter((r) => !['SuperAdmin', 'Patient'].includes(r.name)),
        ),
      ),
    },
    branch: {
      findFirst: jest.fn(({ where }: { where: { id: string; clinicId: string } }) => {
        const branch = branches.get(where.id);
        if (!branch || branch.clinicId !== where.clinicId) return Promise.resolve(null);
        return Promise.resolve(branch);
      }),
    },
    department: {
      findFirst: jest.fn(() => Promise.resolve(null)),
    },
    clinicMembership: {
      findFirst: jest.fn(({ where }: { where: { id: string; clinicId: string } }) => {
        const m = memberships.get(where.id);
        if (!m || m.clinicId !== where.clinicId) return Promise.resolve(null);
        return Promise.resolve(withRelations(m));
      }),
      findMany: jest.fn(
        ({ where, skip, take }: { where: { clinicId: string }; skip: number; take: number }) => {
          const all = [...memberships.values()].filter((m) => m.clinicId === where.clinicId);
          return Promise.resolve(all.slice(skip, skip + take).map(withRelations));
        },
      ),
      count: jest.fn(({ where }: { where: { clinicId: string } }) =>
        Promise.resolve(
          [...memberships.values()].filter((m) => m.clinicId === where.clinicId).length,
        ),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const m: MembershipRow = {
          id: randomUUID(),
          userId: data.userId as string,
          clinicId: data.clinicId as string,
          roleId: data.roleId as string,
          branchId: (data.branchId as string) ?? null,
          departmentId: (data.departmentId as string) ?? null,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        memberships.set(m.id, m);
        return Promise.resolve(withRelations(m));
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown> & { user?: { update?: Record<string, unknown> } };
        }) => {
          const m = memberships.get(where.id)!;
          const { user: userUpdate, ...rest } = data;
          Object.assign(m, rest);
          if (userUpdate?.update) {
            Object.assign(users.get(m.userId)!, userUpdate.update);
          }
          return Promise.resolve(withRelations(m));
        },
      ),
    },
    staffInvitation: {
      upsert: jest.fn(({ create }: { create: { userId: string; tokenHash: string } }) => {
        invitations.set(create.userId, create);
        return Promise.resolve({});
      }),
      updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
    refreshToken: {
      updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
  };

  (fakePrisma as Record<string, unknown>).$transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(fakePrisma);
  });

  return fakePrisma;
}

describe('Staff (e2e) — guard chain, tenant isolation, RBAC, invite flow', () => {
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
      const res = await request(server()).get('/api/v1/staff');
      expect(res.status).toBe(401);
    });
  });

  describe('permissions (RBAC)', () => {
    it('rejects a non-ClinicAdmin role inviting staff', async () => {
      const res = await request(server())
        .post('/api/v1/staff')
        .set('Authorization', auth(nurseNoAccessPayload))
        .send({ email: 'x@clinic-a.test', firstName: 'X', lastName: 'Y', roleId: ROLE_NURSE });
      expect(res.status).toBe(403);
    });

    it('rejects a non-ClinicAdmin role listing staff', async () => {
      const res = await request(server())
        .get('/api/v1/staff')
        .set('Authorization', auth(nurseNoAccessPayload));
      expect(res.status).toBe(403);
    });

    it('rejects a non-ClinicAdmin role revoking access', async () => {
      const res = await request(server())
        .post('/api/v1/staff/membership-a1/revoke-access')
        .set('Authorization', auth(nurseNoAccessPayload));
      expect(res.status).toBe(403);
    });
  });

  describe('Super Admin protection', () => {
    it('rejects assigning the SuperAdmin role when inviting staff (cannot create Super Admin accounts)', async () => {
      const res = await request(server())
        .post('/api/v1/staff')
        .set('Authorization', auth(adminAPayload))
        .send({
          email: 'wannabe-super@clinic-a.test',
          firstName: 'X',
          lastName: 'Y',
          roleId: ROLE_SUPERADMIN,
        });
      expect(res.status).toBe(403);
    });

    it('rejects assigning the Patient role to staff', async () => {
      const res = await request(server())
        .post('/api/v1/staff')
        .set('Authorization', auth(adminAPayload))
        .send({
          email: 'not-a-patient@clinic-a.test',
          firstName: 'X',
          lastName: 'Y',
          roleId: ROLE_PATIENT,
        });
      expect(res.status).toBe(400);
    });

    it('never lists SuperAdmin/Patient among assignable roles', async () => {
      const res = await request(server())
        .get('/api/v1/staff/roles')
        .set('Authorization', auth(adminAPayload));
      expect(res.status).toBe(200);
      const names = (res.body as { name: string }[]).map((r) => r.name);
      expect(names).not.toContain('SuperAdmin');
      expect(names).not.toContain('Patient');
    });
  });

  describe('duplicate email handling', () => {
    it('rejects inviting a staff member with an email already in use (409)', async () => {
      const res = await request(server())
        .post('/api/v1/staff')
        .set('Authorization', auth(adminAPayload))
        .send({
          email: 'existing@clinic-a.test',
          firstName: 'Dup',
          lastName: 'Licate',
          roleId: ROLE_NURSE,
        });
      expect(res.status).toBe(409);
    });
  });

  describe('branch assignment', () => {
    it('rejects a branchId from another clinic (400, not leaked as 404)', async () => {
      const res = await request(server())
        .post('/api/v1/staff')
        .set('Authorization', auth(adminAPayload))
        .send({
          email: 'newnurse@clinic-a.test',
          firstName: 'New',
          lastName: 'Nurse',
          roleId: ROLE_NURSE,
          branchId: BRANCH_2,
        });
      expect(res.status).toBe(400);
    });

    it('invites a staff member with a valid same-clinic branch, returning a one-time invite token', async () => {
      const res = await request(server())
        .post('/api/v1/staff')
        .set('Authorization', auth(adminAPayload))
        .send({
          email: 'branch-nurse@clinic-a.test',
          firstName: 'Branch',
          lastName: 'Nurse',
          roleId: ROLE_NURSE,
          branchId: BRANCH_1,
        });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        clinicId: CLINIC_A,
        userStatus: 'PENDING',
        invitePending: true,
        branch: { id: BRANCH_1 },
      });
      const body = res.body as { invite: { token: string } };
      expect(typeof body.invite.token).toBe('string');
      expect(body.invite.token.length).toBeGreaterThan(20);
    });
  });

  describe('tenant isolation', () => {
    it("Clinic B's admin cannot read Clinic A's staff member by id (404, not leaked)", async () => {
      const res = await request(server())
        .get('/api/v1/staff/membership-a1')
        .set('Authorization', auth(adminBPayload));
      expect(res.status).toBe(404);
    });

    it("Clinic A's admin can read Clinic A's staff member", async () => {
      const res = await request(server())
        .get('/api/v1/staff/membership-a1')
        .set('Authorization', auth(adminAPayload));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'membership-a1', clinicId: CLINIC_A });
    });

    it("Clinic B's admin cannot assign a role to Clinic A's staff member (404, not leaked)", async () => {
      const res = await request(server())
        .patch('/api/v1/staff/membership-a1/role')
        .set('Authorization', auth(adminBPayload))
        .send({ roleId: ROLE_CLINICADMIN });
      expect(res.status).toBe(404);
    });

    it("Clinic B's admin cannot revoke Clinic A's staff member's access (404, not leaked)", async () => {
      const res = await request(server())
        .post('/api/v1/staff/membership-a1/revoke-access')
        .set('Authorization', auth(adminBPayload));
      expect(res.status).toBe(404);
    });
  });

  describe('role assignment', () => {
    it("rejects a roleId that belongs to no clinic template and isn't recognized", async () => {
      const res = await request(server())
        .patch('/api/v1/staff/membership-a1/role')
        .set('Authorization', auth(adminAPayload))
        .send({ roleId: ROLE_DOES_NOT_EXIST });
      expect(res.status).toBe(400);
    });

    it('assigns a valid clinic-visible role', async () => {
      const res = await request(server())
        .patch('/api/v1/staff/membership-a1/role')
        .set('Authorization', auth(adminAPayload))
        .send({ roleId: ROLE_CLINICADMIN });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ role: { id: ROLE_CLINICADMIN, name: 'ClinicAdmin' } });
    });
  });

  describe('inactive user behavior', () => {
    it('deactivates a staff member (status -> INACTIVE)', async () => {
      const res = await request(server())
        .patch('/api/v1/staff/membership-a1/status')
        .set('Authorization', auth(adminAPayload))
        .send({ status: 'INACTIVE' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'INACTIVE' });
    });

    it('rejects a ClinicAdmin deactivating their own access', async () => {
      // adminAPayload.sub has no membership row of its own in this fixture,
      // so use membership-a1's owning user for the self-check by minting a
      // token whose sub matches that membership's userId.
      const selfPayload: JwtPayload = {
        ...adminAPayload,
        sub: 'user-existing-a',
      };
      const res = await request(server())
        .patch('/api/v1/staff/membership-a1/status')
        .set('Authorization', auth(selfPayload))
        .send({ status: 'INACTIVE' });
      expect(res.status).toBe(403);
    });
  });

  describe('validation', () => {
    it('rejects an unknown extra field (forbidNonWhitelisted), including client-supplied clinicId', async () => {
      const res = await request(server())
        .post('/api/v1/staff')
        .set('Authorization', auth(adminAPayload))
        .send({
          email: 'x2@clinic-a.test',
          firstName: 'X',
          lastName: 'Y',
          roleId: ROLE_NURSE,
          clinicId: 'clinic-b',
        });
      expect(res.status).toBe(400);
    });

    it('rejects a missing required field with 400', async () => {
      const res = await request(server())
        .post('/api/v1/staff')
        .set('Authorization', auth(adminAPayload))
        .send({ firstName: 'No Email Or Role' });
      expect(res.status).toBe(400);
    });
  });
});
