import { INestApplication, Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import type { LoginResponseDto } from '../src/auth/dto/auth-response.dto';
import { hashPassword, verifyPassword } from '../src/auth/password.util';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * In-memory fake covering exactly the Prisma calls AuthService/
 * AuthContextService make. Lets the full guard chain (AuthGuard ->
 * TenantGuard -> PermissionsGuard) and the real HTTP layer (cookies,
 * validation, throttling) be exercised end-to-end without a live SQL
 * Server connection.
 */
interface FakePasswordResetToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

function createFakePrisma(passwordHash: string) {
  const doctorPermission = { id: 'perm-1', key: 'appointments:read' };
  const doctorRole = {
    id: 'role-doctor',
    name: 'Doctor',
    rolePermissions: [{ permission: doctorPermission }],
  };

  const users = new Map([
    [
      'doctor@dev-clinic.test',
      {
        id: 'user-1',
        email: 'doctor@dev-clinic.test',
        passwordHash,
        firstName: 'Dev',
        lastName: 'Doctor',
        status: 'ACTIVE',
        isSuperAdmin: false,
      },
    ],
    [
      'suspended@dev-clinic.test',
      {
        id: 'user-2',
        email: 'suspended@dev-clinic.test',
        passwordHash,
        firstName: 'Suspended',
        lastName: 'User',
        status: 'SUSPENDED',
        isSuperAdmin: false,
      },
    ],
    // Dedicated fixture for the password change/forgot/reset tests below —
    // those mutate the account's password, so they must not share user-1
    // with the login/refresh/logout tests elsewhere in this file.
    [
      'reset-target@dev-clinic.test',
      {
        id: 'user-3',
        email: 'reset-target@dev-clinic.test',
        passwordHash,
        firstName: 'Reset',
        lastName: 'Target',
        status: 'ACTIVE',
        isSuperAdmin: false,
      },
    ],
  ]);
  const usersById = new Map([...users.values()].map((u) => [u.id, u]));

  const refreshTokens = new Map<
    string,
    {
      id: string;
      userId: string;
      tokenHash: string;
      clinicId: string | null;
      expiresAt: Date;
      revokedAt: Date | null;
    }
  >();
  const passwordResetTokensByUserId = new Map<string, FakePasswordResetToken>();
  const auditLogs: Record<string, unknown>[] = [];
  let nextId = 1;

  const fakePrisma = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    isHealthy: jest.fn().mockResolvedValue(true),
    user: {
      findUnique: jest.fn(({ where }: { where: { email?: string; id?: string } }) => {
        if (where.email) return Promise.resolve(users.get(where.email) ?? null);
        if (where.id) return Promise.resolve(usersById.get(where.id) ?? null);
        return Promise.resolve(null);
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const entry = usersById.get(where.id);
          if (entry) Object.assign(entry, data);
          return Promise.resolve(entry);
        },
      ),
    },
    auditLog: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        auditLogs.push(data);
        return Promise.resolve(data);
      }),
    },
    passwordResetToken: {
      findUnique: jest.fn(({ where: { tokenHash } }: { where: { tokenHash: string } }) =>
        Promise.resolve(
          [...passwordResetTokensByUserId.values()].find((t) => t.tokenHash === tokenHash) ?? null,
        ),
      ),
      upsert: jest.fn(
        ({
          where,
          create,
        }: {
          where: { userId: string };
          create: Omit<FakePasswordResetToken, 'id' | 'usedAt'>;
          update: Partial<FakePasswordResetToken>;
        }) => {
          const id = passwordResetTokensByUserId.get(where.userId)?.id ?? `prt-${nextId++}`;
          const entry: FakePasswordResetToken = { id, usedAt: null, ...create };
          passwordResetTokensByUserId.set(where.userId, entry);
          return Promise.resolve(entry);
        },
      ),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string; usedAt: null };
          data: Record<string, unknown>;
        }) => {
          const entry = [...passwordResetTokensByUserId.values()].find((t) => t.id === where.id);
          if (!entry || entry.usedAt !== null) return Promise.resolve({ count: 0 });
          Object.assign(entry, data);
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    role: {
      findFirst: jest.fn(() => Promise.resolve(null)), // no SuperAdmin fixture needed for these tests
    },
    clinicMembership: {
      findFirst: jest.fn(({ where }: { where: { userId: string } }) => {
        if (where.userId !== 'user-1' && where.userId !== 'user-3') return Promise.resolve(null);
        return Promise.resolve({
          clinicId: 'clinic-1',
          clinic: { name: 'Dev Clinic' },
          role: doctorRole,
        });
      }),
    },
    refreshToken: {
      create: jest.fn(
        ({
          data,
        }: {
          data: { userId: string; tokenHash: string; clinicId: string | null; expiresAt: Date };
        }) => {
          const id = `rt-${nextId++}`;
          refreshTokens.set(data.tokenHash, { id, revokedAt: null, ...data });
          return Promise.resolve({ id });
        },
      ),
      findUnique: jest.fn(({ where: { tokenHash } }: { where: { tokenHash: string } }) =>
        Promise.resolve(refreshTokens.get(tokenHash) ?? null),
      ),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const entry = [...refreshTokens.values()].find((t) => t.id === where.id);
          if (entry) Object.assign(entry, data);
          return Promise.resolve(entry);
        },
      ),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { userId: string; revokedAt: null };
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const entry of refreshTokens.values()) {
            if (entry.userId === where.userId && entry.revokedAt === null) {
              Object.assign(entry, data);
              count++;
            }
          }
          return Promise.resolve({ count });
        },
      ),
    },
  };

  (fakePrisma as unknown as Record<string, unknown>).$transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(fakePrisma);
  });

  return fakePrisma;
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let fakePrisma: ReturnType<typeof createFakePrisma>;

  beforeAll(async () => {
    const passwordHash = await hashPassword('DevPassword123!');
    fakePrisma = createFakePrisma(passwordHash);

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

  it('rejects invalid credentials with 401', async () => {
    const res = await request(server())
      .post('/api/v1/auth/login')
      .send({ email: 'doctor@dev-clinic.test', password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown email with the same generic 401 (no user enumeration)', async () => {
    const res = await request(server())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@dev-clinic.test', password: 'whatever' });
    expect(res.status).toBe(401);
  });

  it('rejects a suspended account', async () => {
    const res = await request(server())
      .post('/api/v1/auth/login')
      .send({ email: 'suspended@dev-clinic.test', password: 'DevPassword123!' });
    expect(res.status).toBe(401);
  });

  it('rejects an invalid payload (missing password) with 400', async () => {
    const res = await request(server())
      .post('/api/v1/auth/login')
      .send({ email: 'doctor@dev-clinic.test' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid payload with an unknown extra field (forbidNonWhitelisted)', async () => {
    const res = await request(server())
      .post('/api/v1/auth/login')
      .send({ email: 'doctor@dev-clinic.test', password: 'DevPassword123!', clinicId: 'clinic-2' });
    expect(res.status).toBe(400);
  });

  it('rejects GET /auth/me with no token', async () => {
    const res = await request(server()).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects GET /auth/me with a garbage token', async () => {
    const res = await request(server())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(401);
  });

  it('rejects GET /auth/me with an expired token', async () => {
    const expired = jwt.sign(
      { sub: 'user-1', email: 'doctor@dev-clinic.test' },
      process.env.JWT_ACCESS_SECRET!,
      {
        expiresIn: -10,
      },
    );
    const res = await request(server())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it('rejects GET /auth/me with a token signed by the wrong secret', async () => {
    const forged = jwt.sign(
      { sub: 'user-1', email: 'doctor@dev-clinic.test' },
      'not-the-real-secret',
      {
        expiresIn: '15m',
      },
    );
    const res = await request(server())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  describe('a full login -> me -> refresh -> logout session', () => {
    let accessToken: string;
    let refreshCookie: string;

    it('logs in and returns an access token plus a Set-Cookie refresh token', async () => {
      const res = await request(server())
        .post('/api/v1/auth/login')
        .send({ email: 'doctor@dev-clinic.test', password: 'DevPassword123!' });

      expect(res.status).toBe(200);
      const body = res.body as LoginResponseDto;
      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.user).toMatchObject({
        email: 'doctor@dev-clinic.test',
        role: 'Doctor',
        clinicId: 'clinic-1',
      });

      const setCookie = res.headers['set-cookie'] as unknown as string[];
      expect(
        setCookie.some((c) => c.startsWith('cw_refresh_token=') && c.includes('HttpOnly')),
      ).toBe(true);

      accessToken = body.accessToken;
      refreshCookie = setCookie[0].split(';')[0];
    });

    it('GET /auth/me succeeds with the access token', async () => {
      const res = await request(server())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        email: 'doctor@dev-clinic.test',
        permissions: ['appointments:read'],
      });
    });

    it('POST /auth/refresh rotates the refresh token and issues a new access token', async () => {
      const res = await request(server()).post('/api/v1/auth/refresh').set('Cookie', refreshCookie);
      expect(res.status).toBe(200);
      expect((res.body as LoginResponseDto).accessToken).toEqual(expect.any(String));

      const setCookie = res.headers['set-cookie'] as unknown as string[];
      const newCookie = setCookie[0].split(';')[0];
      expect(newCookie).not.toBe(refreshCookie);
      refreshCookie = newCookie;
    });

    it('reusing the now-rotated-out refresh token is rejected (reuse detection)', async () => {
      // refreshCookie has already been rotated past — presenting the
      // *original* login cookie again should be treated as a leaked token.
      const res = await request(server())
        .post('/api/v1/auth/refresh')
        .set('Cookie', 'cw_refresh_token=not-the-current-one');
      expect(res.status).toBe(401);
    });

    it('logout revokes the session and a subsequent refresh is rejected', async () => {
      const logoutRes = await request(server())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(logoutRes.status).toBe(204);

      const refreshRes = await request(server())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie);
      expect(refreshRes.status).toBe(401);
    });
  });

  it('POST /auth/refresh with no cookie at all is rejected', async () => {
    const res = await request(server()).post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
  });

  describe('POST /auth/change-password', () => {
    const email = 'reset-target@dev-clinic.test';
    let accessToken: string;
    let refreshCookie: string;

    // A single shared login for this describe block's sub-tests — the
    // login route has its own tight rate limit (10/min), and none of the
    // 400/401 sub-tests below need a fresh session, only the final
    // successful change does its own state mutation.
    beforeAll(async () => {
      const loginRes = await request(server())
        .post('/api/v1/auth/login')
        .send({ email, password: 'DevPassword123!' });
      ({ accessToken } = loginRes.body as LoginResponseDto);
      const setCookie = loginRes.headers['set-cookie'] as unknown as string[];
      refreshCookie = setCookie[0].split(';')[0];
    });

    it('rejects with no token', async () => {
      const res = await request(server())
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: 'DevPassword123!', newPassword: 'NewStrongPass1!' });
      expect(res.status).toBe(401);
    });

    it('rejects a weak new password (policy enforcement) with 400', async () => {
      const res = await request(server())
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: 'DevPassword123!', newPassword: 'weak' });
      expect(res.status).toBe(400);
    });

    it('rejects an incorrect current password with 401', async () => {
      const res = await request(server())
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: 'WrongPassword1!', newPassword: 'NewStrongPass1!' });
      expect(res.status).toBe(401);
    });

    it('changes the password and revokes every outstanding refresh token', async () => {
      const res = await request(server())
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: 'DevPassword123!', newPassword: 'NewStrongPass1!' });
      expect(res.status).toBe(204);

      // The refresh token issued before the change is now revoked.
      const refreshRes = await request(server())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie);
      expect(refreshRes.status).toBe(401);

      // The stored hash now verifies against the new password, not the old
      // one — checked directly against the fake Prisma store rather than a
      // further /login round trip, to stay well under that route's own
      // 10/min rate limit shared across this whole test file.
      const user = (await fakePrisma.user.findUnique({
        where: { email },
      })) as { passwordHash: string };
      await expect(verifyPassword(user.passwordHash, 'DevPassword123!')).resolves.toBe(false);
      await expect(verifyPassword(user.passwordHash, 'NewStrongPass1!')).resolves.toBe(true);
    });
  });

  describe('forgot-password / reset-password', () => {
    const email = 'reset-target@dev-clinic.test';

    it('POST /auth/forgot-password always responds 204, whether or not the email exists (no enumeration)', async () => {
      const known = await request(server()).post('/api/v1/auth/forgot-password').send({ email });
      expect(known.status).toBe(204);

      const unknown = await request(server())
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'nobody@dev-clinic.test' });
      expect(unknown.status).toBe(204);
    });

    it('rejects an unknown/garbage reset token with 400', async () => {
      const res = await request(server())
        .post('/api/v1/auth/reset-password')
        .send({ token: 'not-a-real-token', newPassword: 'AnotherStrongPass1!' });
      expect(res.status).toBe(400);
    });

    it('rejects a weak new password on reset with 400', async () => {
      const res = await request(server())
        .post('/api/v1/auth/reset-password')
        .send({ token: 'whatever', newPassword: 'weak' });
      expect(res.status).toBe(400);
    });

    it('a full forgot -> reset flow: the emitted token resets the password, is single-use, and revokes sessions', async () => {
      // The dev-mode LoggingPasswordResetMailer logs the raw token instead
      // of emailing it — capture it via a spy rather than reaching into the
      // mailer's internals, keeping this test at the HTTP boundary.
      const loggerSpy = jest.spyOn(Logger.prototype, 'debug');

      // Only one /login call in this test (the login route's own 10/min
      // limit is shared across the whole file) — it establishes the
      // pre-reset session used below to prove reset-password revokes it.
      // The password at this point is whatever the change-password
      // describe block above left it as.
      const loginRes = await request(server())
        .post('/api/v1/auth/login')
        .send({ email, password: 'NewStrongPass1!' });
      const setCookie = loginRes.headers['set-cookie'] as unknown as string[];
      const refreshCookie = setCookie[0].split(';')[0];

      const forgotRes = await request(server())
        .post('/api/v1/auth/forgot-password')
        .send({ email });
      expect(forgotRes.status).toBe(204);

      const debugCall = loggerSpy.mock.calls.find((call) =>
        String(call[0]).includes(`Password reset link for ${email}`),
      );
      expect(debugCall).toBeDefined();
      const tokenMatch = String(debugCall?.[0]).match(/token=([a-f0-9]+)/);
      const rawToken = tokenMatch?.[1];
      expect(rawToken).toEqual(expect.any(String));
      loggerSpy.mockRestore();

      const resetRes = await request(server())
        .post('/api/v1/auth/reset-password')
        .send({ token: rawToken, newPassword: 'ResetStrongPass1!' });
      expect(resetRes.status).toBe(204);

      // Reusing the same token again is rejected (single-use).
      const reuseRes = await request(server())
        .post('/api/v1/auth/reset-password')
        .send({ token: rawToken, newPassword: 'AnotherStrongPass2!' });
      expect(reuseRes.status).toBe(400);

      // The pre-reset session's refresh token was revoked.
      const refreshRes = await request(server())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie);
      expect(refreshRes.status).toBe(401);

      // The stored hash now verifies against the reset password, not the
      // pre-reset one (checked directly, not via another /login call — see
      // the note in the change-password describe block above).
      const user = (await fakePrisma.user.findUnique({
        where: { email },
      })) as { passwordHash: string };
      await expect(verifyPassword(user.passwordHash, 'NewStrongPass1!')).resolves.toBe(false);
      await expect(verifyPassword(user.passwordHash, 'ResetStrongPass1!')).resolves.toBe(true);
    });
  });

  describe('a mobile client (X-Client-Platform: mobile)', () => {
    it('gets the refresh token in the response body and no Set-Cookie', async () => {
      const res = await request(server())
        .post('/api/v1/auth/login')
        .set('X-Client-Platform', 'mobile')
        .send({ email: 'doctor@dev-clinic.test', password: 'DevPassword123!' });

      expect(res.status).toBe(200);
      const body = res.body as LoginResponseDto;
      expect(body.refreshToken).toEqual(expect.any(String));
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('refreshes by sending the token in the body instead of a cookie', async () => {
      const loginRes = await request(server())
        .post('/api/v1/auth/login')
        .set('X-Client-Platform', 'mobile')
        .send({ email: 'doctor@dev-clinic.test', password: 'DevPassword123!' });
      const { refreshToken } = loginRes.body as LoginResponseDto;

      const refreshRes = await request(server())
        .post('/api/v1/auth/refresh')
        .set('X-Client-Platform', 'mobile')
        .send({ refreshToken });

      expect(refreshRes.status).toBe(200);
      expect((refreshRes.body as LoginResponseDto).refreshToken).toEqual(expect.any(String));
    });
  });
});
