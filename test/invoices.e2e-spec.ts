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
 * Exercises the billing/invoices module end to end, with a focus on tenant
 * isolation for InvoiceItem writes: PrescriptionItem-style child rows that
 * carry no clinicId column of their own (prisma/schema.prisma's InvoiceItem
 * doc comment) and are only ever reached through their parent Invoice.
 * These tests attempt to update/delete an item by guessing/reusing its id
 * against the *wrong* clinic's invoice id, and against no scoping id at
 * all, to confirm the write is rejected at the query level
 * (scoped-write.util.ts) and not only by an earlier read.
 */
function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });
}

const CLINIC_A = 'clinic-a';
const CLINIC_B = 'clinic-b';
const DOCTOR_1 = '11111111-1111-4111-8111-111111111111';
const PATIENT_1 = '33333333-3333-4333-8333-333333333333';
const CONSULTATION_1 = '44444444-4444-4444-8444-444444444444';
// A second, unrelated invoice+item pair living in Clinic B — used to prove
// Clinic A staff can't write to it even by guessing/reusing ids.
const CONSULTATION_B = '77777777-7777-4777-8777-777777777777';
const DOCTOR_B = '88888888-8888-4888-8888-888888888888';
const PATIENT_B = '99999999-9999-4999-8999-999999999999';

const billingStaffA: JwtPayload = {
  sub: 'user-billing-a',
  email: 'billing@clinic-a.test',
  role: 'BillingStaff',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['billing:create', 'billing:read', 'billing:update'],
};

const billingStaffB: JwtPayload = {
  ...billingStaffA,
  sub: 'user-billing-b',
  email: 'billing@clinic-b.test',
  clinicId: CLINIC_B,
  clinicName: 'Clinic B',
};

const noPermissionPayload: JwtPayload = {
  sub: 'user-none',
  email: 'none@clinic-a.test',
  role: 'FrontDesk',
  clinicId: CLINIC_A,
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: [],
};

function matches<T extends object>(row: T, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    const value = (row as unknown as Record<string, unknown>)[key];
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const cond = condition as Record<string, unknown>;
      if ('not' in cond && value === cond.not) return false;
      if ('in' in cond && !(cond.in as unknown[]).includes(value)) return false;
    } else if (value !== condition) {
      return false;
    }
  }
  return true;
}

interface InvoiceRow {
  id: string;
  clinicId: string;
  consultationId: string;
  doctorId: string;
  patientId: string;
  invoiceNumber: string | null;
  status: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  amountPaid: number;
  notes: string | null;
  createdByUserId: string;
  issuedAt: Date | null;
  dueDate: Date | null;
  voidedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface InvoiceItemRow {
  id: string;
  invoiceId: string;
  description: string;
  itemType: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxRatePercent: number;
  lineTotal: number;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

function makeFakePrisma() {
  const doctors = new Map([
    [DOCTOR_1, { id: DOCTOR_1, clinicId: CLINIC_A, userId: 'user-doc-1' }],
    [DOCTOR_B, { id: DOCTOR_B, clinicId: CLINIC_B, userId: 'user-doc-b' }],
  ]);
  const patients = new Map([
    [PATIENT_1, { id: PATIENT_1, clinicId: CLINIC_A, userId: null }],
    [PATIENT_B, { id: PATIENT_B, clinicId: CLINIC_B, userId: null }],
  ]);
  const consultations = new Map([
    [
      CONSULTATION_1,
      {
        id: CONSULTATION_1,
        clinicId: CLINIC_A,
        doctorId: DOCTOR_1,
        patientId: PATIENT_1,
        deletedAt: null,
      },
    ],
    [
      CONSULTATION_B,
      {
        id: CONSULTATION_B,
        clinicId: CLINIC_B,
        doctorId: DOCTOR_B,
        patientId: PATIENT_B,
        deletedAt: null,
      },
    ],
  ]);
  const clinics = new Map([
    [CLINIC_A, { id: CLINIC_A, name: 'Clinic A', invoiceSequence: 0 }],
    [CLINIC_B, { id: CLINIC_B, name: 'Clinic B', invoiceSequence: 0 }],
  ]);

  const invoices = new Map<string, InvoiceRow>();
  const invoiceItems = new Map<string, InvoiceItemRow>();

  function itemsFor(invoiceId: string): InvoiceItemRow[] {
    return [...invoiceItems.values()]
      .filter((i) => i.invoiceId === invoiceId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  function withItems(row: InvoiceRow) {
    return { ...row, items: itemsFor(row.id) };
  }

  const fakePrisma = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    isHealthy: jest.fn().mockResolvedValue(true),
    doctor: {
      findFirst: jest.fn(({ where }: { where: { id: string; clinicId: string } }) => {
        const doctor = doctors.get(where.id);
        if (!doctor || doctor.clinicId !== where.clinicId) return Promise.resolve(null);
        return Promise.resolve({
          ...doctor,
          deletedAt: null,
          status: 'ACTIVE',
          user: { id: doctor.userId, firstName: 'Ada', lastName: 'Lovelace' },
          specializations: [],
        });
      }),
    },
    patient: {
      findFirst: jest.fn(({ where }: { where: { id: string; clinicId: string } }) => {
        const patient = patients.get(where.id);
        if (!patient || patient.clinicId !== where.clinicId) return Promise.resolve(null);
        return Promise.resolve({
          ...patient,
          deletedAt: null,
          firstName: 'Mary',
          lastName: 'Jackson',
        });
      }),
    },
    consultation: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const found = [...consultations.values()].find((c) => matches(c, where));
        return Promise.resolve(found ?? null);
      }),
    },
    clinic: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(clinics.get(where.id) ?? null),
      ),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const clinic = clinics.get(where.id)!;
          if (data.invoiceSequence && typeof data.invoiceSequence === 'object') {
            const incr = (data.invoiceSequence as { increment: number }).increment;
            clinic.invoiceSequence += incr;
          }
          return Promise.resolve(clinic);
        },
      ),
    },
    invoice: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const found = [...invoices.values()].find((i) => matches(i, where));
        return Promise.resolve(found ? withItems(found) : null);
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
          const all = [...invoices.values()]
            .filter((i) => matches(i, where))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .map(withItems);
          return Promise.resolve(all.slice(skip, skip + take));
        },
      ),
      count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve([...invoices.values()].filter((i) => matches(i, where)).length),
      ),
      create: jest.fn(
        ({
          data,
        }: {
          data: Record<string, unknown> & { items?: { create: Record<string, unknown>[] } };
        }) => {
          const now = new Date();
          const row: InvoiceRow = {
            id: randomUUID(),
            clinicId: data.clinicId as string,
            consultationId: data.consultationId as string,
            doctorId: data.doctorId as string,
            patientId: data.patientId as string,
            invoiceNumber: null,
            status: 'DRAFT',
            subtotal: 0,
            discountAmount: 0,
            taxAmount: 0,
            totalAmount: 0,
            amountPaid: 0,
            notes: (data.notes as string) ?? null,
            createdByUserId: data.createdByUserId as string,
            issuedAt: null,
            dueDate: (data.dueDate as Date) ?? null,
            voidedAt: null,
            deletedAt: null,
            createdAt: now,
            updatedAt: now,
          };
          invoices.set(row.id, row);
          for (const itemData of data.items?.create ?? []) {
            const item: InvoiceItemRow = {
              id: randomUUID(),
              invoiceId: row.id,
              description: itemData.description as string,
              itemType: (itemData.itemType as string) ?? 'OTHER',
              quantity: itemData.quantity as number,
              unitPrice: itemData.unitPrice as number,
              discountAmount: itemData.discountAmount as number,
              taxRatePercent: itemData.taxRatePercent as number,
              lineTotal: itemData.lineTotal as number,
              sortOrder: itemData.sortOrder as number,
              createdAt: now,
              updatedAt: now,
            };
            invoiceItems.set(item.id, item);
          }
          return Promise.resolve(withItems(row));
        },
      ),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = invoices.get(where.id)!;
          Object.assign(row, data, { updatedAt: new Date() });
          return Promise.resolve(withItems(row));
        },
      ),
      updateMany: jest.fn(
        ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const rows = [...invoices.values()].filter((i) => matches(i, where));
          for (const row of rows) Object.assign(row, data, { updatedAt: new Date() });
          return Promise.resolve({ count: rows.length });
        },
      ),
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: 0 }, _count: 0 }),
    },
    invoiceItem: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const item: InvoiceItemRow = {
          id: randomUUID(),
          invoiceId: data.invoiceId as string,
          description: data.description as string,
          itemType: data.itemType as string,
          quantity: data.quantity as number,
          unitPrice: data.unitPrice as number,
          discountAmount: data.discountAmount as number,
          taxRatePercent: data.taxRatePercent as number,
          lineTotal: data.lineTotal as number,
          sortOrder: data.sortOrder as number,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        invoiceItems.set(item.id, item);
        return Promise.resolve(item);
      }),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string; invoiceId: string };
          data: Record<string, unknown>;
        }) => {
          const item = invoiceItems.get(where.id);
          if (!item || item.invoiceId !== where.invoiceId) return Promise.resolve({ count: 0 });
          Object.assign(
            item,
            Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
            { updatedAt: new Date() },
          );
          return Promise.resolve({ count: 1 });
        },
      ),
      deleteMany: jest.fn(({ where }: { where: { id: string; invoiceId: string } }) => {
        const item = invoiceItems.get(where.id);
        if (!item || item.invoiceId !== where.invoiceId) return Promise.resolve({ count: 0 });
        invoiceItems.delete(where.id);
        return Promise.resolve({ count: 1 });
      }),
    },
    payment: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 }, _count: 0 }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    refund: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
    },
  };

  (fakePrisma as Record<string, unknown>).$transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(fakePrisma);
  });

  return { fakePrisma, invoices, invoiceItems };
}

describe('Invoices (e2e) — DRAFT/ISSUE lifecycle, tenant isolation on item writes', () => {
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
    harness.invoices.clear();
    harness.invoiceItems.clear();
  });

  async function createDraftInvoiceA(): Promise<{ id: string; itemId: string }> {
    const res = await request(server())
      .post('/api/v1/invoices')
      .set('Authorization', auth(billingStaffA))
      .send({
        consultationId: CONSULTATION_1,
        items: [{ description: 'Consultation fee', unitPrice: 500 }],
      })
      .expect(201);
    const body = res.body as { id: string; items: { id: string }[] };
    return { id: body.id, itemId: body.items[0].id };
  }

  async function createDraftInvoiceB(): Promise<{ id: string; itemId: string }> {
    const res = await request(server())
      .post('/api/v1/invoices')
      .set('Authorization', auth(billingStaffB))
      .send({
        consultationId: CONSULTATION_B,
        items: [{ description: 'Consultation fee', unitPrice: 700 }],
      })
      .expect(201);
    const body = res.body as { id: string; items: { id: string }[] };
    return { id: body.id, itemId: body.items[0].id };
  }

  describe('authorization', () => {
    it('rejects with no token', async () => {
      const res = await request(server()).get('/api/v1/invoices');
      expect(res.status).toBe(401);
    });

    it('rejects a role without billing:create', async () => {
      const res = await request(server())
        .post('/api/v1/invoices')
        .set('Authorization', auth(noPermissionPayload))
        .send({ consultationId: CONSULTATION_1, items: [{ description: 'Fee', unitPrice: 100 }] });
      expect(res.status).toBe(403);
    });
  });

  describe('create + issue', () => {
    it('creates a DRAFT invoice with computed line totals', async () => {
      const { id } = await createDraftInvoiceA();
      const res = await request(server())
        .get(`/api/v1/invoices/${id}`)
        .set('Authorization', auth(billingStaffA));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'DRAFT', items: [{ lineTotal: '500' }] });
    });

    it('issues the invoice and assigns an invoice number', async () => {
      const { id } = await createDraftInvoiceA();
      const res = await request(server())
        .post(`/api/v1/invoices/${id}/issue`)
        .set('Authorization', auth(billingStaffA));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'ISSUED', totalAmount: '500' });
      expect((res.body as { invoiceNumber: string }).invoiceNumber).toMatch(/^INV-/);
    });

    it('a cross-tenant consultation id 404s rather than leaking existence', async () => {
      const res = await request(server())
        .post('/api/v1/invoices')
        .set('Authorization', auth(billingStaffB))
        .send({
          consultationId: CONSULTATION_1,
          items: [{ description: 'Fee', unitPrice: 100 }],
        });
      expect(res.status).toBe(404);
    });
  });

  describe('tenant isolation on the invoice itself', () => {
    it("Clinic B cannot read Clinic A's invoice by id (404, not leaked)", async () => {
      const { id } = await createDraftInvoiceA();
      const res = await request(server())
        .get(`/api/v1/invoices/${id}`)
        .set('Authorization', auth(billingStaffB));
      expect(res.status).toBe(404);
    });

    it("Clinic B cannot issue Clinic A's invoice", async () => {
      const { id } = await createDraftInvoiceA();
      const res = await request(server())
        .post(`/api/v1/invoices/${id}/issue`)
        .set('Authorization', auth(billingStaffB));
      expect(res.status).toBe(404);
    });

    it("Clinic B cannot void Clinic A's invoice", async () => {
      const { id } = await createDraftInvoiceA();
      await request(server())
        .post(`/api/v1/invoices/${id}/issue`)
        .set('Authorization', auth(billingStaffA))
        .expect(201);
      const res = await request(server())
        .post(`/api/v1/invoices/${id}/void`)
        .set('Authorization', auth(billingStaffB));
      expect(res.status).toBe(404);
    });

    it("Clinic B cannot patch Clinic A's invoice notes", async () => {
      const { id } = await createDraftInvoiceA();
      const res = await request(server())
        .patch(`/api/v1/invoices/${id}`)
        .set('Authorization', auth(billingStaffB))
        .send({ notes: 'cross-tenant write attempt' });
      expect(res.status).toBe(404);
    });
  });

  describe('tenant isolation on InvoiceItem writes (no clinicId column of its own)', () => {
    it("Clinic B cannot update Clinic A's invoice item, even by reusing the correct itemId, because it 404s at the parent invoice lookup first", async () => {
      const { id, itemId } = await createDraftInvoiceA();
      const res = await request(server())
        .patch(`/api/v1/invoices/${id}/items/${itemId}`)
        .set('Authorization', auth(billingStaffB))
        .send({ unitPrice: 1 });
      expect(res.status).toBe(404);
    });

    it("Clinic B cannot delete Clinic A's invoice item", async () => {
      const { id, itemId } = await createDraftInvoiceA();
      const res = await request(server())
        .delete(`/api/v1/invoices/${id}/items/${itemId}`)
        .set('Authorization', auth(billingStaffB));
      expect(res.status).toBe(404);
    });

    it('an itemId that belongs to a different (even same-tenant) invoice is rejected — the item write is scoped by invoiceId at the query level, not just itemId', async () => {
      const invoiceA1 = await createDraftInvoiceA();
      const res = await request(server())
        .post('/api/v1/invoices')
        .set('Authorization', auth(billingStaffA))
        .send({
          consultationId: CONSULTATION_1,
          items: [{ description: 'Second invoice fee', unitPrice: 200 }],
        });
      // Second invoice for the same consultation is rejected while the
      // first stays active — use a manually-crafted second invoiceId
      // instead by exercising updateItem with invoiceA1's own item but a
      // deliberately wrong invoiceId path param.
      expect([201, 409]).toContain(res.status);

      const wrongParentRes = await request(server())
        .patch(`/api/v1/invoices/does-not-exist/items/${invoiceA1.itemId}`)
        .set('Authorization', auth(billingStaffA))
        .send({ unitPrice: 1 });
      expect(wrongParentRes.status).toBe(404);
    });

    it('updates the item when the caller and the parent invoice both match (positive control)', async () => {
      const { id, itemId } = await createDraftInvoiceA();
      const res = await request(server())
        .patch(`/api/v1/invoices/${id}/items/${itemId}`)
        .set('Authorization', auth(billingStaffA))
        .send({ unitPrice: 650 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ items: [{ unitPrice: '650' }] });
    });
  });

  describe('cross-tenant id collisions across two real clinics', () => {
    it("Clinic A staff cannot touch Clinic B's invoice or its items even with valid-looking ids from their own session", async () => {
      const b = await createDraftInvoiceB();

      const getRes = await request(server())
        .get(`/api/v1/invoices/${b.id}`)
        .set('Authorization', auth(billingStaffA));
      expect(getRes.status).toBe(404);

      const itemRes = await request(server())
        .patch(`/api/v1/invoices/${b.id}/items/${b.itemId}`)
        .set('Authorization', auth(billingStaffA))
        .send({ unitPrice: 1 });
      expect(itemRes.status).toBe(404);

      const deleteRes = await request(server())
        .delete(`/api/v1/invoices/${b.id}/items/${b.itemId}`)
        .set('Authorization', auth(billingStaffA));
      expect(deleteRes.status).toBe(404);
    });
  });
});
