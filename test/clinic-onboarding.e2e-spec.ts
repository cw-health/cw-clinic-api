import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import type { JwtPayload } from '../src/auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Exercises the tenant self-service onboarding wizard (Phase 1A) end to
 * end over the real AuthGuard -> TenantGuard -> PermissionsGuard chain —
 * same pattern as doctors.e2e-spec.ts. Every route here is `/clinics/me/
 * onboarding/...`, so there is no `:clinicId` path param to attack; the
 * cross-tenant checks below instead confirm each admin's writes only ever
 * touch their own clinic's row (docs/SECURITY.md §4).
 */
function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });
}

const CLINIC_A = 'clinic-a';
const CLINIC_B = 'clinic-b';

const CLINIC_SETTINGS_PERMISSIONS = ['clinic-settings:read', 'clinic-settings:update'];

const adminAPayload: JwtPayload = {
  sub: 'user-admin-a',
  email: 'admin@clinic-a.test',
  role: 'ClinicAdmin',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: CLINIC_SETTINGS_PERMISSIONS,
};

const adminBPayload: JwtPayload = {
  sub: 'user-admin-b',
  email: 'admin@clinic-b.test',
  role: 'ClinicAdmin',
  clinicId: CLINIC_B,
  clinicName: 'Clinic B',
  isSuperAdmin: false,
  permissions: CLINIC_SETTINGS_PERMISSIONS,
};

const readOnlyAdminAPayload: JwtPayload = {
  ...adminAPayload,
  sub: 'user-viewer-a',
  permissions: ['clinic-settings:read'],
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

/** A SuperAdmin session with no resolved clinic membership — TenantGuard/requireClinicId must reject it, not silently operate on someone's clinic. */
const superAdminNoClinicPayload: JwtPayload = {
  sub: 'user-super-1',
  email: 'super@platform.test',
  role: null,
  clinicId: null,
  clinicName: null,
  isSuperAdmin: true,
  permissions: ['super-admin:clinics-read', 'super-admin:clinics-update'],
};

interface OnboardingStatusBody {
  steps: { key: string; completed: boolean }[];
}

interface ClinicRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  facilityType: string | null;
  legalName: string | null;
  legalEntityType: string | null;
  description: string | null;
  registrationApplicable: boolean;
  registrationNumber: string | null;
  registrationAuthority: string | null;
  registrationDate: Date | null;
  registrationExpiryDate: Date | null;
  taxIdentifierType: string | null;
  taxIdentifierValue: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  alternatePhone: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  timezone: string;
  currency: string;
  defaultAppointmentDurationMinutes: number;
  onboardingStatus: string;
  onboardingCompletedAt: Date | null;
  primaryAdminUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function makeClinicRow(id: string): ClinicRow {
  return {
    id,
    name: `Clinic ${id}`,
    slug: id,
    status: 'ACTIVE',
    facilityType: null,
    legalName: null,
    legalEntityType: null,
    description: null,
    registrationApplicable: true,
    registrationNumber: null,
    registrationAuthority: null,
    registrationDate: null,
    registrationExpiryDate: null,
    taxIdentifierType: null,
    taxIdentifierValue: null,
    contactEmail: null,
    contactPhone: null,
    alternatePhone: null,
    website: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
    timezone: 'UTC',
    currency: 'INR',
    defaultAppointmentDurationMinutes: 15,
    onboardingStatus: 'NOT_STARTED',
    onboardingCompletedAt: null,
    primaryAdminUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeFakePrisma() {
  const clinics = new Map<string, ClinicRow>();
  clinics.set(CLINIC_A, makeClinicRow(CLINIC_A));
  clinics.set(CLINIC_B, makeClinicRow(CLINIC_B));
  const auditEvents: Array<Record<string, unknown>> = [];

  function withPrimaryAdmin(row: ClinicRow) {
    return {
      ...row,
      primaryAdminUser: row.primaryAdminUserId
        ? { id: row.primaryAdminUserId, firstName: 'A', lastName: 'B', email: 'admin@test.com' }
        : null,
    };
  }

  const fakePrisma = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    isHealthy: jest.fn().mockResolvedValue(true),
    clinic: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) => {
        const row = clinics.get(where.id);
        return Promise.resolve(row ? withPrimaryAdmin(row) : null);
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = clinics.get(where.id)!;
          Object.assign(row, data);
          return Promise.resolve(withPrimaryAdmin(row));
        },
      ),
    },
    clinicWorkingHours: {
      count: jest.fn().mockResolvedValue(0),
    },
    auditLog: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        auditEvents.push(data);
        return Promise.resolve(data);
      }),
    },
  };

  (fakePrisma as Record<string, unknown>).$transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(fakePrisma);
  });

  return { fakePrisma, clinics, auditEvents };
}

describe('Clinic onboarding wizard (e2e) — guard chain, tenant isolation, validation', () => {
  let app: INestApplication;
  let clinics: Map<string, ClinicRow>;
  let auditEvents: Array<Record<string, unknown>>;

  beforeAll(async () => {
    const fake = makeFakePrisma();
    clinics = fake.clinics;
    auditEvents = fake.auditEvents;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(fake.fakePrisma)
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
    it('rejects GET onboarding status with no token', async () => {
      const res = await request(server()).get('/api/v1/clinics/me/onboarding');
      expect(res.status).toBe(401);
    });
  });

  describe('authorization', () => {
    it('rejects a role without clinic-settings:update from writing a step', async () => {
      const res = await request(server())
        .patch('/api/v1/clinics/me/onboarding/basic-info')
        .set('Authorization', auth(frontDeskNoAccessPayload))
        .send({ contactEmail: 'front-desk@clinic-a.test' });
      expect(res.status).toBe(403);
    });

    it('rejects a read-only session from completing onboarding', async () => {
      const res = await request(server())
        .post('/api/v1/clinics/me/onboarding/complete')
        .set('Authorization', auth(readOnlyAdminAPayload));
      expect(res.status).toBe(403);
    });

    it('rejects a SuperAdmin session with no clinic membership (no clinic to onboard)', async () => {
      const res = await request(server())
        .get('/api/v1/clinics/me/onboarding')
        .set('Authorization', auth(superAdminNoClinicPayload));
      expect(res.status).toBe(403);
    });
  });

  describe('validation', () => {
    it('rejects an invalid facilityType with 400', async () => {
      const res = await request(server())
        .patch('/api/v1/clinics/me/onboarding/basic-info')
        .set('Authorization', auth(adminAPayload))
        .send({ facilityType: 'SPACESHIP' });
      expect(res.status).toBe(400);
    });

    it('rejects a malformed contactEmail with 400', async () => {
      const res = await request(server())
        .patch('/api/v1/clinics/me/onboarding/basic-info')
        .set('Authorization', auth(adminAPayload))
        .send({ contactEmail: 'not-an-email' });
      expect(res.status).toBe(400);
    });

    it('rejects a step payload carrying a field outside its whitelist (e.g. legal fields on the basic-info step)', async () => {
      const res = await request(server())
        .patch('/api/v1/clinics/me/onboarding/basic-info')
        .set('Authorization', auth(adminAPayload))
        .send({ legalEntityType: 'LLP' });
      expect(res.status).toBe(400);
    });
  });

  describe('partial onboarding progression', () => {
    it('starts NOT_STARTED, then IN_PROGRESS after the first step, tracking currentStep', async () => {
      const initial = await request(server())
        .get('/api/v1/clinics/me/onboarding')
        .set('Authorization', auth(adminAPayload));
      expect(initial.status).toBe(200);
      expect(initial.body).toMatchObject({
        onboardingStatus: 'NOT_STARTED',
        currentStep: 'BASIC_INFO',
      });

      const step1 = await request(server())
        .patch('/api/v1/clinics/me/onboarding/basic-info')
        .set('Authorization', auth(adminAPayload))
        .send({ contactEmail: 'contact@clinic-a.test', facilityType: 'CLINIC' });
      expect(step1.status).toBe(200);
      expect(step1.body).toMatchObject({ onboardingStatus: 'IN_PROGRESS', facilityType: 'CLINIC' });

      const afterStep1 = await request(server())
        .get('/api/v1/clinics/me/onboarding')
        .set('Authorization', auth(adminAPayload));
      expect(afterStep1.body).toMatchObject({ currentStep: 'LEGAL_INFO' });
      const stepsBody = afterStep1.body as OnboardingStatusBody;
      expect(stepsBody.steps.find((s) => s.key === 'BASIC_INFO')?.completed).toBe(true);

      // ONBOARDING_STARTED fires exactly once, on the transition out of NOT_STARTED.
      expect(auditEvents.filter((e) => e.action === 'ONBOARDING_STARTED')).toHaveLength(1);
    });

    it('rejects completion while required fields are still missing, listing them', async () => {
      const res = await request(server())
        .post('/api/v1/clinics/me/onboarding/complete')
        .set('Authorization', auth(adminAPayload));
      expect(res.status).toBe(400);
      const body = res.body as { message: { missingRequiredFields: string[] } };
      expect(body.message.missingRequiredFields).toEqual(
        expect.arrayContaining(['address', 'legalEntityType', 'primaryAdmin']),
      );
    });
  });

  describe('completion', () => {
    it('completes once every required field is present, and audits ONBOARDING_COMPLETED', async () => {
      await request(server())
        .patch('/api/v1/clinics/me/onboarding/legal-info')
        .set('Authorization', auth(adminAPayload))
        .send({ legalEntityType: 'PRIVATE_COMPANY' });
      await request(server())
        .patch('/api/v1/clinics/me/onboarding/address')
        .set('Authorization', auth(adminAPayload))
        .send({ addressLine1: '1 Main St', city: 'Springfield', country: 'USA' });
      await request(server())
        .post('/api/v1/clinics/me/onboarding/primary-admin')
        .set('Authorization', auth(adminAPayload));

      const complete = await request(server())
        .post('/api/v1/clinics/me/onboarding/complete')
        .set('Authorization', auth(adminAPayload));

      expect(complete.status).toBe(201);
      expect(complete.body).toMatchObject({
        onboardingStatus: 'COMPLETED',
        missingRequiredFields: [],
      });
      expect(auditEvents.filter((e) => e.action === 'ONBOARDING_COMPLETED')).toHaveLength(1);
    });
  });

  describe('cross-tenant isolation', () => {
    it("clinic B's onboarding is untouched by clinic A's writes", async () => {
      const res = await request(server())
        .get('/api/v1/clinics/me/onboarding')
        .set('Authorization', auth(adminBPayload));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ onboardingStatus: 'NOT_STARTED' });
      expect(clinics.get(CLINIC_B)!.contactEmail).toBeNull();
      // Clinic A really did progress, proving isolation isn't just "nothing happened".
      expect(clinics.get(CLINIC_A)!.onboardingStatus).toBe('COMPLETED');
    });

    it('rejects a primary-admin takeover from a different clinic B user once clinic A already has one', async () => {
      const res = await request(server())
        .post('/api/v1/clinics/me/onboarding/primary-admin')
        .set('Authorization', auth(adminBPayload));
      // Clinic B has no primary admin yet, so this succeeds for its own tenant...
      expect(res.status).toBe(201);
      expect(clinics.get(CLINIC_B)!.primaryAdminUserId).toBe(adminBPayload.sub);
      // ...and never as clinic A's user id, since actorUserId always comes from the JWT.
      expect(clinics.get(CLINIC_A)!.primaryAdminUserId).not.toBe(adminBPayload.sub);
    });
  });
});
