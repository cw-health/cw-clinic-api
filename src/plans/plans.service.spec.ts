import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { PlansService } from './plans.service';

function makeService(overrides?: Partial<Record<string, unknown>>) {
  const prisma = {
    plan: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    planFeature: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    ...overrides,
  };
  (prisma as Record<string, unknown>).$transaction = jest.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(prisma);
  });
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new PlansService(
    prisma as unknown as PrismaService,
    auditService as unknown as AuditService,
  );
  return { service, prisma, auditService };
}

const PLAN_ROW = {
  id: 'plan-a',
  name: 'Starter',
  description: null,
  status: 'ACTIVE',
  price: { toString: () => '999.00' },
  currency: 'INR',
  billingInterval: 'MONTHLY',
  maxDoctors: 5,
  maxStaff: null,
  maxPatients: null,
  maxBranches: null,
  trialDays: null,
  features: [{ key: 'WHATSAPP' }],
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

describe('PlansService', () => {
  describe('listPlans', () => {
    it('paginates and maps rows through toPlanResponseDto', async () => {
      const { service, prisma } = makeService();
      prisma.plan.count.mockResolvedValue(1);
      prisma.plan.findMany.mockResolvedValue([PLAN_ROW]);

      const result = await service.listPlans({ page: 2, pageSize: 10, status: 'ACTIVE' });

      expect(result.meta).toEqual({ total: 1, page: 2, pageSize: 10 });
      expect(result.data).toEqual([
        expect.objectContaining({ id: 'plan-a', price: '999.00', features: ['WHATSAPP'] }),
      ]);
      /* eslint-disable @typescript-eslint/no-unsafe-assignment */
      expect(prisma.plan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ACTIVE' }),
          skip: 10,
          take: 10,
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('searches by name or description', async () => {
      const { service, prisma } = makeService();
      prisma.plan.count.mockResolvedValue(0);
      prisma.plan.findMany.mockResolvedValue([]);

      await service.listPlans({ search: 'starter' });

      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
      const call = prisma.plan.findMany.mock.calls[0][0];
      expect(call.where.OR).toEqual([
        { name: { contains: 'starter' } },
        { description: { contains: 'starter' } },
      ]);
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
    });
  });

  describe('getPlanById', () => {
    it('404s when the plan does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.plan.findUnique.mockResolvedValue(null);
      await expect(service.getPlanById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createPlan', () => {
    it('rejects a duplicate plan name', async () => {
      const { service, prisma } = makeService();
      prisma.plan.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(
        service.createPlan({ name: 'Starter', price: 100, billingInterval: 'MONTHLY' }, 'admin-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('creates the plan, syncs features, and records a platform-actor audit event', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.plan.findUnique.mockResolvedValue(null);
      prisma.plan.create.mockResolvedValue({ id: 'plan-new' });
      prisma.plan.findUniqueOrThrow.mockResolvedValue(PLAN_ROW);

      const plan = await service.createPlan(
        {
          name: 'Starter',
          price: 999,
          billingInterval: 'MONTHLY',
          features: ['WHATSAPP'],
        },
        'admin-1',
      );

      expect(plan.id).toBe('plan-a');
      expect(prisma.planFeature.createMany).toHaveBeenCalledWith({
        data: [{ planId: 'plan-new', key: 'WHATSAPP' }],
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: null,
          actorUserId: 'admin-1',
          actorType: 'PLATFORM_USER',
          entity: 'Plan',
          entityId: 'plan-a',
          action: 'CREATE',
        }),
      );
    });

    it('does not touch planFeature when no features are given', async () => {
      const { service, prisma } = makeService();
      prisma.plan.findUnique.mockResolvedValue(null);
      prisma.plan.create.mockResolvedValue({ id: 'plan-new' });
      prisma.plan.findUniqueOrThrow.mockResolvedValue(PLAN_ROW);

      await service.createPlan(
        { name: 'Starter', price: 999, billingInterval: 'MONTHLY' },
        'admin-1',
      );

      expect(prisma.planFeature.createMany).not.toHaveBeenCalled();
    });
  });

  describe('updatePlan', () => {
    it('404s when the plan does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.plan.findUnique.mockResolvedValue(null);
      await expect(service.updatePlan('plan-a', { name: 'New' }, 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects renaming to a name already used by another plan', async () => {
      const { service, prisma } = makeService();
      prisma.plan.findUnique
        .mockResolvedValueOnce(PLAN_ROW) // getPlanRowOrThrow
        .mockResolvedValueOnce({ id: 'plan-b' }); // name conflict check
      await expect(service.updatePlan('plan-a', { name: 'Taken' }, 'admin-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('leaves features untouched when the DTO omits them', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.plan.findUnique.mockResolvedValueOnce(PLAN_ROW);
      prisma.plan.findUniqueOrThrow.mockResolvedValue(PLAN_ROW);

      await service.updatePlan('plan-a', { description: 'Updated' }, 'admin-1');

      expect(prisma.planFeature.deleteMany).not.toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', actorType: 'PLATFORM_USER', clinicId: null }),
      );
    });

    it('replaces the full feature set when features are provided', async () => {
      const { service, prisma } = makeService();
      prisma.plan.findUnique.mockResolvedValueOnce(PLAN_ROW);
      prisma.plan.findUniqueOrThrow.mockResolvedValue(PLAN_ROW);

      await service.updatePlan('plan-a', { features: ['AI_SCRIBE'] }, 'admin-1');

      expect(prisma.planFeature.deleteMany).toHaveBeenCalledWith({ where: { planId: 'plan-a' } });
      expect(prisma.planFeature.createMany).toHaveBeenCalledWith({
        data: [{ planId: 'plan-a', key: 'AI_SCRIBE' }],
      });
    });

    it('clears all features when an empty array is provided', async () => {
      const { service, prisma } = makeService();
      prisma.plan.findUnique.mockResolvedValueOnce(PLAN_ROW);
      prisma.plan.findUniqueOrThrow.mockResolvedValue(PLAN_ROW);

      await service.updatePlan('plan-a', { features: [] }, 'admin-1');

      expect(prisma.planFeature.deleteMany).toHaveBeenCalledWith({ where: { planId: 'plan-a' } });
      expect(prisma.planFeature.createMany).not.toHaveBeenCalled();
    });
  });

  describe('activatePlan / deactivatePlan', () => {
    it('activates and records an audit event', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.plan.findUnique.mockResolvedValue(PLAN_ROW);
      prisma.plan.update.mockResolvedValue({ ...PLAN_ROW, status: 'ACTIVE' });

      await service.activatePlan('plan-a', 'admin-1');

      expect(prisma.plan.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'plan-a' }, data: { status: 'ACTIVE' } }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ACTIVATE', actorType: 'PLATFORM_USER', clinicId: null }),
      );
    });

    it('deactivates and records an audit event', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.plan.findUnique.mockResolvedValue(PLAN_ROW);
      prisma.plan.update.mockResolvedValue({ ...PLAN_ROW, status: 'INACTIVE' });

      await service.deactivatePlan('plan-a', 'admin-1');

      expect(prisma.plan.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'plan-a' }, data: { status: 'INACTIVE' } }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEACTIVATE',
          actorType: 'PLATFORM_USER',
          clinicId: null,
        }),
      );
    });
  });
});
