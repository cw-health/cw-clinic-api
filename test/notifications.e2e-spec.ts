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
 * Exercises the notifications module end to end: a patient sees only their
 * own notifications, unread-count, mark-one-read (ownership scoped, never
 * leaking existence of another user's notification), and mark-all-read.
 */
function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });
}

const CLINIC_A = 'clinic-a';

const patientPayload: JwtPayload = {
  sub: 'user-patient-1',
  email: 'patient1@clinic-a.test',
  role: 'Patient',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['notifications:read-own'],
};

const otherPatientPayload: JwtPayload = {
  ...patientPayload,
  sub: 'user-patient-2',
  email: 'patient2@clinic-a.test',
};

const noPermissionPayload: JwtPayload = {
  ...patientPayload,
  sub: 'user-none',
  permissions: [],
};

interface NotificationRow {
  id: string;
  clinicId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  readAt: Date | null;
  pushStatus: string;
  createdAt: Date;
  updatedAt: Date;
}

function makeFakePrisma() {
  const notifications = new Map<string, NotificationRow>();
  const deviceTokens = new Map<string, { userId: string; token: string; platform: string }>();

  function matches(row: NotificationRow, where: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(where)) {
      if (value === null) {
        if ((row as unknown as Record<string, unknown>)[key] !== null) return false;
      } else if ((row as unknown as Record<string, unknown>)[key] !== value) {
        return false;
      }
    }
    return true;
  }

  const fakePrisma = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    isHealthy: jest.fn().mockResolvedValue(true),
    notification: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row: NotificationRow = {
          id: randomUUID(),
          clinicId: data.clinicId as string,
          userId: data.userId as string,
          type: data.type as string,
          title: data.title as string,
          body: data.body as string,
          relatedEntityType: (data.relatedEntityType as string) ?? null,
          relatedEntityId: (data.relatedEntityId as string) ?? null,
          readAt: null,
          pushStatus: 'PENDING',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        notifications.set(row.id, row);
        return Promise.resolve(row);
      }),
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const found = [...notifications.values()].find((n) => matches(n, where));
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
          const all = [...notifications.values()]
            .filter((n) => matches(n, where))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return Promise.resolve(all.slice(skip, skip + take));
        },
      ),
      count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve([...notifications.values()].filter((n) => matches(n, where)).length),
      ),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = notifications.get(where.id)!;
          Object.assign(row, data, { updatedAt: new Date() });
          return Promise.resolve(row);
        },
      ),
      updateMany: jest.fn(
        ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const matching = [...notifications.values()].filter((n) => matches(n, where));
          for (const row of matching) Object.assign(row, data, { updatedAt: new Date() });
          return Promise.resolve({ count: matching.length });
        },
      ),
      findFirstOrThrow: jest.fn(({ where }: { where: { id: string } }) => {
        const row = notifications.get(where.id);
        if (!row) throw new Error('Notification not found');
        return Promise.resolve(row);
      }),
    },
    userDeviceToken: {
      upsert: jest.fn(
        ({ where, create }: { where: { token: string }; create: Record<string, unknown> }) => {
          const row = deviceTokens.get(where.token) ?? { ...create, token: where.token };
          Object.assign(row, create);
          deviceTokens.set(where.token, row as { userId: string; token: string; platform: string });
          return Promise.resolve(row);
        },
      ),
      findUnique: jest.fn(({ where }: { where: { token: string } }) =>
        Promise.resolve(deviceTokens.get(where.token) ?? null),
      ),
      delete: jest.fn(({ where }: { where: { token: string } }) => {
        const row = deviceTokens.get(where.token)!;
        deviceTokens.delete(where.token);
        return Promise.resolve(row);
      }),
    },
  };

  (fakePrisma as Record<string, unknown>).$transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(fakePrisma);
  });

  return { fakePrisma, notifications, deviceTokens };
}

describe('Notifications (e2e) — patient self-service, ownership scoping', () => {
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
    harness.notifications.clear();
    harness.deviceTokens.clear();
  });

  function seed(overrides: Partial<NotificationRow> = {}): NotificationRow {
    const row: NotificationRow = {
      id: randomUUID(),
      clinicId: CLINIC_A,
      userId: patientPayload.sub,
      type: 'APPOINTMENT_BOOKED',
      title: 'Appointment booked',
      body: 'Your appointment has been booked.',
      relatedEntityType: 'Appointment',
      relatedEntityId: 'appt-1',
      readAt: null,
      pushStatus: 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
    harness.notifications.set(row.id, row);
    return row;
  }

  describe('authorization', () => {
    it('rejects with no token', async () => {
      const res = await request(server()).get('/api/v1/notifications/me');
      expect(res.status).toBe(401);
    });

    it('rejects a role without notifications:read-own', async () => {
      const res = await request(server())
        .get('/api/v1/notifications/me')
        .set('Authorization', auth(noPermissionPayload));
      expect(res.status).toBe(403);
    });
  });

  describe('GET /notifications/me', () => {
    it('a patient sees only their own notifications', async () => {
      seed({ id: 'notif-own' });
      seed({ id: 'notif-other', userId: otherPatientPayload.sub });

      const res = await request(server())
        .get('/api/v1/notifications/me')
        .set('Authorization', auth(patientPayload));
      expect(res.status).toBe(200);
      const body = res.body as { data: { id: string }[]; meta: { total: number } };
      expect(body.meta.total).toBe(1);
      expect(body.data.map((n) => n.id)).toEqual(['notif-own']);
    });

    it('filters to unread only when unreadOnly=true', async () => {
      seed({ id: 'notif-unread' });
      seed({ id: 'notif-read', readAt: new Date() });

      const res = await request(server())
        .get('/api/v1/notifications/me?unreadOnly=true')
        .set('Authorization', auth(patientPayload));
      const body = res.body as { data: { id: string }[] };
      expect(body.data.map((n) => n.id)).toEqual(['notif-unread']);
    });
  });

  describe('GET /notifications/me/unread-count', () => {
    it('counts only the caller unread notifications', async () => {
      seed({ id: 'notif-unread-1' });
      seed({ id: 'notif-unread-2' });
      seed({ id: 'notif-read', readAt: new Date() });
      seed({ id: 'notif-other-unread', userId: otherPatientPayload.sub });

      const res = await request(server())
        .get('/api/v1/notifications/me/unread-count')
        .set('Authorization', auth(patientPayload));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ count: 2 });
    });
  });

  describe('POST /notifications/:id/read', () => {
    it('marks the caller-owned notification read', async () => {
      const row = seed();
      const res = await request(server())
        .post(`/api/v1/notifications/${row.id}/read`)
        .set('Authorization', auth(patientPayload));
      expect(res.status).toBe(201);
      expect((res.body as { readAt: string | null }).readAt).not.toBeNull();
    });

    it("404s on another patient's notification, never leaking existence", async () => {
      const row = seed({ userId: otherPatientPayload.sub });
      const res = await request(server())
        .post(`/api/v1/notifications/${row.id}/read`)
        .set('Authorization', auth(patientPayload));
      expect(res.status).toBe(404);
    });

    it('404s for a nonexistent id', async () => {
      const res = await request(server())
        .post(`/api/v1/notifications/${randomUUID()}/read`)
        .set('Authorization', auth(patientPayload));
      expect(res.status).toBe(404);
    });
  });

  describe('POST /notifications/read-all', () => {
    it("marks all of the caller's unread notifications read and returns the count", async () => {
      seed({ id: 'notif-1' });
      seed({ id: 'notif-2' });
      seed({ id: 'notif-other', userId: otherPatientPayload.sub });

      const res = await request(server())
        .post('/api/v1/notifications/read-all')
        .set('Authorization', auth(patientPayload));
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ updated: 2 });

      // The other patient's notification is untouched.
      expect(harness.notifications.get('notif-other')!.readAt).toBeNull();
    });
  });

  describe('POST /notifications/device-tokens and DELETE .../device-tokens/:token', () => {
    it('registers a device token for the caller (self-scoped, not from the request body)', async () => {
      const res = await request(server())
        .post('/api/v1/notifications/device-tokens')
        .set('Authorization', auth(patientPayload))
        .send({ token: 'fcm-token-1', platform: 'ANDROID' });
      expect(res.status).toBe(201);
      expect(harness.deviceTokens.get('fcm-token-1')).toEqual({
        userId: patientPayload.sub,
        token: 'fcm-token-1',
        platform: 'ANDROID',
      });
    });

    it('re-registering the same token is idempotent (upsert)', async () => {
      await request(server())
        .post('/api/v1/notifications/device-tokens')
        .set('Authorization', auth(patientPayload))
        .send({ token: 'fcm-token-2', platform: 'ANDROID' });
      const res = await request(server())
        .post('/api/v1/notifications/device-tokens')
        .set('Authorization', auth(patientPayload))
        .send({ token: 'fcm-token-2', platform: 'IOS' });
      expect(res.status).toBe(201);
      expect(harness.deviceTokens.size).toBe(1);
      expect(harness.deviceTokens.get('fcm-token-2')?.platform).toBe('IOS');
    });

    it('unregisters the caller-owned token', async () => {
      await request(server())
        .post('/api/v1/notifications/device-tokens')
        .set('Authorization', auth(patientPayload))
        .send({ token: 'fcm-token-3', platform: 'ANDROID' });
      const res = await request(server())
        .delete('/api/v1/notifications/device-tokens/fcm-token-3')
        .set('Authorization', auth(patientPayload));
      expect(res.status).toBe(200);
      expect(harness.deviceTokens.has('fcm-token-3')).toBe(false);
    });

    it("404s (never leaking existence) unregistering another user's token", async () => {
      await request(server())
        .post('/api/v1/notifications/device-tokens')
        .set('Authorization', auth(otherPatientPayload))
        .send({ token: 'fcm-token-4', platform: 'ANDROID' });
      const res = await request(server())
        .delete('/api/v1/notifications/device-tokens/fcm-token-4')
        .set('Authorization', auth(patientPayload));
      expect(res.status).toBe(404);
    });
  });
});
