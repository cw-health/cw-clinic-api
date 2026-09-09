import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import type { JwtPayload } from '../src/auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Exercises the documents module end to end: staff upload + list +
 * download, patient self-service list/download scoped to their own
 * patient record (404 on someone else's), upload validation (disallowed
 * mime type, oversized file), the secure download-token flow for
 * GET /documents/:id/content, and soft-deleted documents excluded from
 * listings — mirrors test/prescriptions.e2e-spec.ts's fully-mocked
 * in-memory PrismaService approach.
 */
function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });
}

const CLINIC_A = 'clinic-a';
const CLINIC_B = 'clinic-b';
const PATIENT_1 = '33333333-3333-4333-8333-333333333333';
const PATIENT_2 = '44444444-4444-4444-8444-444444444444';

const frontDeskPayload: JwtPayload = {
  sub: 'user-fd-1',
  email: 'fd1@clinic-a.test',
  role: 'FrontDesk',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['documents:create', 'documents:read'],
};

const adminBPayload: JwtPayload = {
  sub: 'user-admin-b',
  email: 'admin@clinic-b.test',
  role: 'ClinicAdmin',
  clinicId: CLINIC_B,
  clinicName: 'Clinic B',
  isSuperAdmin: false,
  permissions: ['documents:create', 'documents:read', 'documents:delete'],
};

const adminAPayload: JwtPayload = {
  ...frontDeskPayload,
  sub: 'user-admin-a',
  role: 'ClinicAdmin',
  permissions: ['documents:create', 'documents:read', 'documents:delete'],
};

const patient1Payload: JwtPayload = {
  sub: 'user-patient-1',
  email: 'patient1@clinic-a.test',
  role: 'Patient',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['documents:read-own'],
};

const patient2Payload: JwtPayload = {
  sub: 'user-patient-2',
  email: 'patient2@clinic-a.test',
  role: 'Patient',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['documents:read-own'],
};

const noPermissionPayload: JwtPayload = {
  ...frontDeskPayload,
  sub: 'user-none',
  permissions: [],
};

function matches<T extends object>(row: T, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    const value = (row as unknown as Record<string, unknown>)[key];
    if (value !== condition) return false;
  }
  return true;
}

interface DocumentRow {
  id: string;
  clinicId: string;
  patientId: string;
  uploadedByUserId: string;
  category: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  notes: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function makeFakePrisma() {
  const patients = new Map([
    [PATIENT_1, { id: PATIENT_1, clinicId: CLINIC_A, userId: patient1Payload.sub }],
    [PATIENT_2, { id: PATIENT_2, clinicId: CLINIC_A, userId: patient2Payload.sub }],
  ]);

  const documents = new Map<string, DocumentRow>();

  const fakePrisma = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    isHealthy: jest.fn().mockResolvedValue(true),
    auditLog: {
      create: jest.fn().mockResolvedValue(undefined),
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
    document: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row: DocumentRow = {
          id: randomUUID(),
          clinicId: data.clinicId as string,
          patientId: data.patientId as string,
          uploadedByUserId: data.uploadedByUserId as string,
          category: data.category as string,
          fileName: data.fileName as string,
          mimeType: data.mimeType as string,
          sizeBytes: data.sizeBytes as number,
          storageKey: data.storageKey as string,
          notes: (data.notes as string) ?? null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        documents.set(row.id, row);
        return Promise.resolve(row);
      }),
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const found = [...documents.values()].find((d) => matches(d, where));
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
          const all = [...documents.values()]
            .filter((d) => matches(d, where))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return Promise.resolve(all.slice(skip, skip + take));
        },
      ),
      count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve([...documents.values()].filter((d) => matches(d, where)).length),
      ),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = documents.get(where.id)!;
          Object.assign(row, data, { updatedAt: new Date() });
          return Promise.resolve(row);
        },
      ),
      updateMany: jest.fn(
        ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const rows = [...documents.values()].filter((d) => matches(d, where));
          for (const row of rows) Object.assign(row, data, { updatedAt: new Date() });
          return Promise.resolve({ count: rows.length });
        },
      ),
    },
  };

  (fakePrisma as Record<string, unknown>).$transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(fakePrisma);
  });

  return { fakePrisma, documents };
}

describe('Documents (e2e) — upload, ownership scoping, secure download, soft delete', () => {
  let app: INestApplication;
  let harness: ReturnType<typeof makeFakePrisma>;
  let storageDir: string;

  beforeAll(async () => {
    harness = makeFakePrisma();
    storageDir = mkdtempSync(path.join(tmpdir(), 'cw-clinic-documents-e2e-'));
    process.env.DOCUMENTS_STORAGE_DIR = storageDir;

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
    rmSync(storageDir, { recursive: true, force: true });
  });

  const server = () => app.getHttpServer() as Server;
  const auth = (payload: JwtPayload) => `Bearer ${signToken(payload)}`;

  beforeEach(() => {
    harness.documents.clear();
  });

  describe('authorization', () => {
    it('rejects with no token', async () => {
      const res = await request(server()).get('/api/v1/documents');
      expect(res.status).toBe(401);
    });

    it('rejects a role without documents:create', async () => {
      const res = await request(server())
        .post('/api/v1/documents')
        .set('Authorization', auth(noPermissionPayload))
        .field('patientId', PATIENT_1)
        .field('category', 'LAB_REPORT')
        .attach('file', Buffer.from('%PDF-1.4 fake'), {
          filename: 'report.pdf',
          contentType: 'application/pdf',
        });
      expect(res.status).toBe(403);
    });
  });

  describe('upload', () => {
    it('staff uploads a document against a patient', async () => {
      const res = await request(server())
        .post('/api/v1/documents')
        .set('Authorization', auth(frontDeskPayload))
        .field('patientId', PATIENT_1)
        .field('category', 'LAB_REPORT')
        .field('notes', 'CBC panel')
        .attach('file', Buffer.from('%PDF-1.4 fake'), {
          filename: 'report.pdf',
          contentType: 'application/pdf',
        });
      expect(res.status).toBe(201);
      const body = res.body as {
        id: string;
        category: string;
        fileName: string;
        patientName: string;
      };
      expect(body.category).toBe('LAB_REPORT');
      expect(body.fileName).toBe('report.pdf');
      expect(body.patientName).toBe('Mary Jackson');
      expect(body).not.toHaveProperty('storageKey');
    });

    it('rejects a disallowed mime type', async () => {
      const res = await request(server())
        .post('/api/v1/documents')
        .set('Authorization', auth(frontDeskPayload))
        .field('patientId', PATIENT_1)
        .field('category', 'OTHER')
        .attach('file', Buffer.from('not a real archive'), {
          filename: 'archive.zip',
          contentType: 'application/zip',
        });
      expect(res.status).toBe(400);
    });

    it('rejects a file over the 10 MiB limit', async () => {
      const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
      const res = await request(server())
        .post('/api/v1/documents')
        .set('Authorization', auth(frontDeskPayload))
        .field('patientId', PATIENT_1)
        .field('category', 'OTHER')
        .attach('file', oversized, { filename: 'big.pdf', contentType: 'application/pdf' });
      // multer's own fileSize limit rejects this before the route handler
      // runs (Nest's FileInterceptor maps LIMIT_FILE_SIZE to 413).
      expect(res.status).toBe(413);
    }, 15000);

    it('a cross-tenant patientId 404s rather than leaking existence', async () => {
      const res = await request(server())
        .post('/api/v1/documents')
        .set('Authorization', auth(adminBPayload))
        .field('patientId', PATIENT_1)
        .field('category', 'OTHER')
        .attach('file', Buffer.from('%PDF-1.4 fake'), {
          filename: 'report.pdf',
          contentType: 'application/pdf',
        });
      expect(res.status).toBe(404);
    });
  });

  describe('staff list + patient self-service', () => {
    async function uploadFor(patientId: string) {
      const res = await request(server())
        .post('/api/v1/documents')
        .set('Authorization', auth(frontDeskPayload))
        .field('patientId', patientId)
        .field('category', 'LAB_REPORT')
        .attach('file', Buffer.from('%PDF-1.4 fake'), {
          filename: 'report.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);
      return (res.body as { id: string }).id;
    }

    it('GET /documents (staff) lists documents clinic-wide', async () => {
      await uploadFor(PATIENT_1);
      await uploadFor(PATIENT_2);

      const res = await request(server())
        .get('/api/v1/documents')
        .set('Authorization', auth(frontDeskPayload));
      expect(res.status).toBe(200);
      expect((res.body as { meta: { total: number } }).meta.total).toBe(2);
    });

    it('GET /documents/me lists only the calling patient’s own documents', async () => {
      await uploadFor(PATIENT_1);
      await uploadFor(PATIENT_2);

      const res = await request(server())
        .get('/api/v1/documents/me')
        .set('Authorization', auth(patient1Payload));
      expect(res.status).toBe(200);
      const body = res.body as { data: { patientId: string }[] };
      expect(body.data).toHaveLength(1);
      expect(body.data[0].patientId).toBe(PATIENT_1);
    });

    it("a patient gets 404 reading another patient's document by id", async () => {
      const id = await uploadFor(PATIENT_2);

      const res = await request(server())
        .get(`/api/v1/documents/${id}`)
        .set('Authorization', auth(patient1Payload));
      expect(res.status).toBe(404);
    });

    it('a patient can read their own document by id', async () => {
      const id = await uploadFor(PATIENT_1);

      const res = await request(server())
        .get(`/api/v1/documents/${id}`)
        .set('Authorization', auth(patient1Payload));
      expect(res.status).toBe(200);
      expect((res.body as { id: string }).id).toBe(id);
    });
  });

  describe('secure content download', () => {
    async function uploadFor(patientId: string) {
      const res = await request(server())
        .post('/api/v1/documents')
        .set('Authorization', auth(frontDeskPayload))
        .field('patientId', patientId)
        .field('category', 'LAB_REPORT')
        .attach('file', Buffer.from('%PDF-1.4 fake content'), {
          filename: 'report.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);
      return (res.body as { id: string }).id;
    }

    it('staff mints a token and downloads the content unauthenticated', async () => {
      const id = await uploadFor(PATIENT_1);

      const tokenRes = await request(server())
        .post(`/api/v1/documents/${id}/download-token`)
        .set('Authorization', auth(frontDeskPayload));
      expect(tokenRes.status).toBe(201);
      const { token } = tokenRes.body as { token: string };

      const contentRes = await request(server()).get(
        `/api/v1/documents/${id}/content?token=${token}`,
      );
      expect(contentRes.status).toBe(200);
      expect(contentRes.headers['content-type']).toContain('application/pdf');
      expect((contentRes.body as Buffer).length).toBeGreaterThan(0);
    });

    it('the owning patient can mint a token and download their own document', async () => {
      const id = await uploadFor(PATIENT_1);

      const tokenRes = await request(server())
        .post(`/api/v1/documents/${id}/download-token`)
        .set('Authorization', auth(patient1Payload));
      expect(tokenRes.status).toBe(201);
      const { token } = tokenRes.body as { token: string };

      const contentRes = await request(server()).get(
        `/api/v1/documents/${id}/content?token=${token}`,
      );
      expect(contentRes.status).toBe(200);
    });

    it("rejects minting a download token for another patient's document", async () => {
      const id = await uploadFor(PATIENT_2);

      const res = await request(server())
        .post(`/api/v1/documents/${id}/download-token`)
        .set('Authorization', auth(patient1Payload));
      expect(res.status).toBe(404);
    });

    it('rejects a garbage/expired token on the content route', async () => {
      const id = await uploadFor(PATIENT_1);
      const res = await request(server()).get(`/api/v1/documents/${id}/content?token=not-a-token`);
      expect(res.status).toBe(401);
    });

    it('rejects a token minted for a different document id', async () => {
      const id = await uploadFor(PATIENT_1);
      const tokenRes = await request(server())
        .post(`/api/v1/documents/${id}/download-token`)
        .set('Authorization', auth(frontDeskPayload));
      const { token } = tokenRes.body as { token: string };

      const res = await request(server()).get(
        `/api/v1/documents/99999999-9999-4999-8999-999999999999/content?token=${token}`,
      );
      expect(res.status).toBe(401);
    });
  });

  describe('soft delete', () => {
    it('DELETE removes a document from listings', async () => {
      const created = await request(server())
        .post('/api/v1/documents')
        .set('Authorization', auth(adminAPayload))
        .field('patientId', PATIENT_1)
        .field('category', 'OTHER')
        .attach('file', Buffer.from('%PDF-1.4 fake'), {
          filename: 'report.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);
      const id = (created.body as { id: string }).id;

      await request(server())
        .delete(`/api/v1/documents/${id}`)
        .set('Authorization', auth(adminAPayload))
        .expect(200);

      const listRes = await request(server())
        .get('/api/v1/documents')
        .set('Authorization', auth(adminAPayload));
      expect((listRes.body as { data: { id: string }[] }).data).toHaveLength(0);

      const getRes = await request(server())
        .get(`/api/v1/documents/${id}`)
        .set('Authorization', auth(adminAPayload));
      expect(getRes.status).toBe(404);
    });

    it('rejects delete for a role without documents:delete', async () => {
      const created = await request(server())
        .post('/api/v1/documents')
        .set('Authorization', auth(frontDeskPayload))
        .field('patientId', PATIENT_1)
        .field('category', 'OTHER')
        .attach('file', Buffer.from('%PDF-1.4 fake'), {
          filename: 'report.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);
      const id = (created.body as { id: string }).id;

      const res = await request(server())
        .delete(`/api/v1/documents/${id}`)
        .set('Authorization', auth(frontDeskPayload));
      expect(res.status).toBe(403);
    });
  });
});
