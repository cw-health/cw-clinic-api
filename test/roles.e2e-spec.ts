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
 * Exercises the real AuthGuard -> TenantGuard -> PermissionsGuard chain
 * end to end over HTTP for the roles module (Phase 1E), same shape as
 * branches.e2e-spec.ts/staff.e2e-spec.ts. Focus areas: role visibility
 * (system template vs. custom, own clinic vs. another's), the archive/
 * reassignment safety flow, and the three privilege-escalation vectors
 * from the task brief (grant Super Admin permissions, modify platform
 * permissions, modify another clinic's roles).
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
  permissions: ['roles:create', 'roles:read', 'roles:update', 'roles:delete'],
};

const adminBPayload: JwtPayload = {
  sub: 'user-admin-b',
  email: 'admin@clinic-b.test',
  role: 'ClinicAdmin',
  clinicId: CLINIC_B,
  clinicName: 'Clinic B',
  isSuperAdmin: false,
  permissions: ['roles:create', 'roles:read', 'roles:update', 'roles:delete'],
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

interface RoleRow {
  id: string;
  clinicId: string | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

interface PermissionRow {
  id: string;
  key: string;
  description: string;
  category: string;
}

interface RolePermissionRow {
  roleId: string;
  permissionId: string;
}

interface MembershipRow {
  id: string;
  userId: string;
  clinicId: string;
  roleId: string;
  status: string;
  createdAt: Date;
}

function makeFakePrisma() {
  const permissions = new Map<string, PermissionRow>();
  const seed = (key: string, category: string) =>
    permissions.set(key, { id: randomUUID(), key, description: key, category });
  seed('patients:read', 'patients');
  seed('patients:create', 'patients');
  seed('roles:read', 'roles');
  seed('roles:create', 'roles');
  seed('clinics:read', 'clinics');
  seed('super-admin:dashboard-read', 'super-admin');

  const roles = new Map<string, RoleRow>();
  const doctorTemplate: RoleRow = {
    id: randomUUID(),
    clinicId: null,
    name: 'Doctor',
    description: 'Clinician',
    isSystem: true,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const superAdminTemplate: RoleRow = {
    id: randomUUID(),
    clinicId: null,
    name: 'SuperAdmin',
    description: 'Platform admin',
    isSystem: true,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const customRoleA: RoleRow = {
    id: randomUUID(),
    clinicId: CLINIC_A,
    name: 'Front Office Lead',
    description: 'Custom role for Clinic A',
    isSystem: false,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  roles.set(doctorTemplate.id, doctorTemplate);
  roles.set(superAdminTemplate.id, superAdminTemplate);
  roles.set(customRoleA.id, customRoleA);

  const rolePermissions: RolePermissionRow[] = [
    { roleId: customRoleA.id, permissionId: permissions.get('patients:read')!.id },
  ];

  const memberships = new Map<string, MembershipRow>();

  function rolePermissionCountFor(roleId: string) {
    return rolePermissions.filter((rp) => rp.roleId === roleId).length;
  }

  const fakePrisma = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    isHealthy: jest.fn().mockResolvedValue(true),
    permission: {
      findMany: jest.fn(
        ({
          where,
        }: {
          where?: {
            key?: { in?: string[] };
            category?: { notIn?: string[] };
            rolePermissions?: { some?: { roleId?: string } };
          };
        } = {}) => {
          let list = [...permissions.values()];
          if (where?.key?.in) list = list.filter((p) => where.key!.in!.includes(p.key));
          if (where?.category?.notIn)
            list = list.filter((p) => !where.category!.notIn!.includes(p.category));
          const roleId = where?.rolePermissions?.some?.roleId;
          if (roleId) {
            const grantedIds = new Set(
              rolePermissions.filter((rp) => rp.roleId === roleId).map((rp) => rp.permissionId),
            );
            list = list.filter((p) => grantedIds.has(p.id));
          }
          return Promise.resolve(list);
        },
      ),
    },
    rolePermission: {
      deleteMany: jest.fn(({ where }: { where: { roleId: string } }) => {
        const before = rolePermissions.length;
        for (let i = rolePermissions.length - 1; i >= 0; i--) {
          if (rolePermissions[i].roleId === where.roleId) rolePermissions.splice(i, 1);
        }
        return Promise.resolve({ count: before - rolePermissions.length });
      }),
      createMany: jest.fn(({ data }: { data: RolePermissionRow[] }) => {
        rolePermissions.push(...data);
        return Promise.resolve({ count: data.length });
      }),
    },
    role: {
      findFirst: jest.fn(({ where }: { where: RoleWhere }) => {
        const list = [...roles.values()];
        const match = list.find((r) => matchesRoleWhere(r, where));
        if (!match) return Promise.resolve(null);
        return Promise.resolve({
          ...match,
          _count: { rolePermissions: rolePermissionCountFor(match.id) },
        });
      }),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(roles.get(where.id) ?? null),
      ),
      findMany: jest.fn(
        ({ where, skip, take }: { where: RoleWhere; skip?: number; take?: number }) => {
          let list = [...roles.values()].filter((r) => matchesRoleWhere(r, where));
          if (typeof skip === 'number' && typeof take === 'number')
            list = list.slice(skip, skip + take);
          return Promise.resolve(
            list.map((r) => ({ ...r, _count: { rolePermissions: rolePermissionCountFor(r.id) } })),
          );
        },
      ),
      count: jest.fn(({ where }: { where: RoleWhere }) =>
        Promise.resolve([...roles.values()].filter((r) => matchesRoleWhere(r, where)).length),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const role: RoleRow = {
          id: randomUUID(),
          clinicId: data.clinicId as string,
          name: data.name as string,
          description: (data.description as string) ?? null,
          isSystem: false,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        roles.set(role.id, role);
        const grant = (data.rolePermissions as { create: { permissionId: string }[] } | undefined)
          ?.create;
        if (grant) {
          for (const g of grant)
            rolePermissions.push({ roleId: role.id, permissionId: g.permissionId });
        }
        return Promise.resolve(role);
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const role = roles.get(where.id)!;
          Object.assign(role, data);
          return Promise.resolve(role);
        },
      ),
    },
    clinicMembership: {
      count: jest.fn(({ where }: { where: MembershipWhere }) =>
        Promise.resolve(
          [...memberships.values()].filter((m) => matchesMembershipWhere(m, where)).length,
        ),
      ),
      findMany: jest.fn(({ where }: { where: MembershipWhere }) =>
        Promise.resolve([...memberships.values()].filter((m) => matchesMembershipWhere(m, where))),
      ),
      updateMany: jest.fn(
        ({ where, data }: { where: MembershipWhere; data: Record<string, unknown> }) => {
          let count = 0;
          for (const m of memberships.values()) {
            if (matchesMembershipWhere(m, where)) {
              Object.assign(m, data);
              count++;
            }
          }
          return Promise.resolve({ count });
        },
      ),
      groupBy: jest.fn(() => Promise.resolve([])),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
  };

  interface RoleWhere {
    id?: string | { not?: string };
    clinicId?: string | null;
    isSystem?: boolean;
    name?: string | { notIn?: string[] };
    OR?: RoleWhere[];
    AND?: RoleWhere[];
  }

  function matchesRoleWhere(role: RoleRow, where: RoleWhere | undefined): boolean {
    if (!where) return true;
    if (typeof where.id === 'string' && role.id !== where.id) return false;
    if (typeof where.id === 'object' && where.id?.not !== undefined && role.id === where.id.not) {
      return false;
    }
    if (where.clinicId !== undefined && role.clinicId !== where.clinicId) return false;
    if (where.isSystem !== undefined && role.isSystem !== where.isSystem) return false;
    if (typeof where.name === 'string' && role.name !== where.name) return false;
    if (typeof where.name === 'object' && where.name?.notIn?.includes(role.name)) return false;
    if (where.OR) return where.OR.some((clause) => matchesRoleWhere(role, clause));
    if (where.AND) return where.AND.every((clause) => matchesRoleWhere(role, clause));
    return true;
  }

  interface MembershipWhere {
    clinicId?: string;
    roleId?: string;
    status?: string;
  }

  function matchesMembershipWhere(m: MembershipRow, where: MembershipWhere | undefined): boolean {
    if (!where) return true;
    if (where.clinicId !== undefined && m.clinicId !== where.clinicId) return false;
    if (where.roleId !== undefined && m.roleId !== where.roleId) return false;
    if (where.status !== undefined && m.status !== where.status) return false;
    return true;
  }

  (fakePrisma as Record<string, unknown>).$transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(fakePrisma);
  });

  return { fakePrisma, roles, memberships, customRoleA, doctorTemplate, superAdminTemplate };
}

describe('Roles (e2e) — guard chain, tenant isolation, RBAC, privilege escalation', () => {
  let app: INestApplication;
  let fixtures: ReturnType<typeof makeFakePrisma>;

  beforeAll(async () => {
    fixtures = makeFakePrisma();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(fixtures.fakePrisma)
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
      const res = await request(server()).get('/api/v1/roles');
      expect(res.status).toBe(401);
    });
  });

  describe('permissions (RBAC)', () => {
    it('rejects a role without roles:read from listing roles', async () => {
      const res = await request(server())
        .get('/api/v1/roles')
        .set('Authorization', auth(frontDeskNoAccessPayload));
      expect(res.status).toBe(403);
    });

    it('rejects a role without roles:create from creating a role', async () => {
      const res = await request(server())
        .post('/api/v1/roles')
        .set('Authorization', auth(frontDeskNoAccessPayload))
        .send({ name: 'New Role', permissionKeys: ['patients:read'] });
      expect(res.status).toBe(403);
    });
  });

  describe('visibility', () => {
    it("lists Clinic A's own custom role plus clinic-visible system templates, excluding SuperAdmin", async () => {
      const res = await request(server())
        .get('/api/v1/roles')
        .set('Authorization', auth(adminAPayload));
      expect(res.status).toBe(200);
      const names = (res.body as { data: { name: string }[] }).data.map((r) => r.name);
      expect(names).toContain('Front Office Lead');
      expect(names).toContain('Doctor');
      expect(names).not.toContain('SuperAdmin');
    });

    it("does not surface Clinic A's custom role to Clinic B", async () => {
      const res = await request(server())
        .get('/api/v1/roles')
        .set('Authorization', auth(adminBPayload));
      expect(res.status).toBe(200);
      const names = (res.body as { data: { name: string }[] }).data.map((r) => r.name);
      expect(names).not.toContain('Front Office Lead');
    });

    it("404s when Clinic B tries to read Clinic A's custom role by id", async () => {
      const res = await request(server())
        .get(`/api/v1/roles/${fixtures.customRoleA.id}`)
        .set('Authorization', auth(adminBPayload));
      expect(res.status).toBe(404);
    });

    it('a system template is readable (for reference) but not owned by any clinic', async () => {
      const res = await request(server())
        .get(`/api/v1/roles/${fixtures.doctorTemplate.id}`)
        .set('Authorization', auth(adminAPayload));
      expect(res.status).toBe(200);
      expect((res.body as { isSystem: boolean }).isSystem).toBe(true);
    });
  });

  describe('privilege escalation', () => {
    it('rejects granting a super-admin:* permission to a new custom role', async () => {
      const res = await request(server())
        .post('/api/v1/roles')
        .set('Authorization', auth(adminAPayload))
        .send({ name: 'Shadow Admin', permissionKeys: ['super-admin:dashboard-read'] });
      expect(res.status).toBe(403);
    });

    it('rejects granting a clinics:* permission to a new custom role', async () => {
      const res = await request(server())
        .post('/api/v1/roles')
        .set('Authorization', auth(adminAPayload))
        .send({ name: 'Tenant Hijacker', permissionKeys: ['clinics:read'] });
      expect(res.status).toBe(403);
    });

    it('rejects modifying the system SuperAdmin role template', async () => {
      const res = await request(server())
        .patch(`/api/v1/roles/${fixtures.superAdminTemplate.id}`)
        .set('Authorization', auth(adminAPayload))
        .send({ description: 'hijacked' });
      expect(res.status).toBe(403);
    });

    it("rejects Clinic B modifying Clinic A's custom role", async () => {
      const res = await request(server())
        .patch(`/api/v1/roles/${fixtures.customRoleA.id}`)
        .set('Authorization', auth(adminBPayload))
        .send({ description: 'pwned' });
      expect(res.status).toBe(404);
    });

    it("rejects Clinic B archiving Clinic A's custom role", async () => {
      const res = await request(server())
        .post(`/api/v1/roles/${fixtures.customRoleA.id}/archive`)
        .set('Authorization', auth(adminBPayload))
        .send({});
      expect(res.status).toBe(404);
    });
  });

  describe('create / update', () => {
    it('creates a custom role with only clinic-safe permissions', async () => {
      const res = await request(server())
        .post('/api/v1/roles')
        .set('Authorization', auth(adminAPayload))
        .send({ name: 'Billing Lead', description: 'x', permissionKeys: ['patients:read'] });
      expect(res.status).toBe(201);
      const body = res.body as { isSystem: boolean; permissions: { key: string }[] };
      expect(body.isSystem).toBe(false);
      expect(body.permissions.map((p) => p.key)).toEqual(['patients:read']);
    });

    it('rejects an empty permission set', async () => {
      const res = await request(server())
        .post('/api/v1/roles')
        .set('Authorization', auth(adminAPayload))
        .send({ name: 'Empty Role', permissionKeys: [] });
      expect(res.status).toBe(400);
    });
  });

  describe('archive with active assignments', () => {
    it('blocks archiving a role that still has active staff, without a reassignment target', async () => {
      fixtures.memberships.set('m1', {
        id: 'm1',
        userId: 'staff-1',
        clinicId: CLINIC_A,
        roleId: fixtures.customRoleA.id,
        status: 'ACTIVE',
        createdAt: new Date(),
      });

      const res = await request(server())
        .post(`/api/v1/roles/${fixtures.customRoleA.id}/archive`)
        .set('Authorization', auth(adminAPayload))
        .send({});
      expect(res.status).toBe(409);
    });

    it('reassigns active staff to the target role and archives when a reassignment target is given', async () => {
      const res = await request(server())
        .post(`/api/v1/roles/${fixtures.customRoleA.id}/archive`)
        .set('Authorization', auth(adminAPayload))
        .send({ reassignToRoleId: fixtures.doctorTemplate.id });
      expect(res.status).toBe(201);
      expect((res.body as { status: string }).status).toBe('INACTIVE');
      expect(fixtures.memberships.get('m1')?.roleId).toBe(fixtures.doctorTemplate.id);
    });
  });
});
