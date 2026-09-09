import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { ClinicsService } from '../clinics/clinics.service';
import type { PlansService } from '../plans/plans.service';
import type { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from './subscriptions.service';

function makeService(overrides?: Partial<Record<string, unknown>>) {
  const prisma = {
    subscription: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    clinic: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
  (prisma as Record<string, unknown>).$transaction = jest.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(prisma);
  });

  const clinicsService = { getClinicById: jest.fn().mockResolvedValue({ id: 'clinic-a' }) };
  const plansService = { getPlanById: jest.fn() };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new SubscriptionsService(
    prisma as unknown as PrismaService,
    clinicsService as unknown as ClinicsService,
    plansService as unknown as PlansService,
    auditService as unknown as AuditService,
  );
  return { service, prisma, clinicsService, plansService, auditService };
}

const PLAN = {
  id: 'plan-a',
  name: 'Starter',
  status: 'ACTIVE',
  price: '999.00',
  currency: 'INR',
  billingInterval: 'MONTHLY',
  trialDays: null as number | null,
};

const TRIAL_PLAN = { ...PLAN, id: 'plan-trial', trialDays: 14 };

function subscriptionRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 'sub-a',
    clinicId: 'clinic-a',
    planId: 'plan-a',
    status: 'ACTIVE',
    currentPeriodStart: new Date('2026-01-01'),
    currentPeriodEnd: new Date('2026-02-01'),
    trialEndsAt: null,
    cancelledAt: null,
    cancellationReason: null,
    supersededAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    plan: PLAN,
    ...overrides,
  };
}

describe('SubscriptionsService', () => {
  describe('getCurrentSubscription', () => {
    it('404s when the clinic has no subscription', async () => {
      const { service, prisma } = makeService();
      prisma.subscription.findFirst.mockResolvedValue(null);
      await expect(service.getCurrentSubscription('clinic-a')).rejects.toThrow(NotFoundException);
    });

    it('returns the non-superseded row', async () => {
      const { service, prisma } = makeService();
      prisma.subscription.findFirst.mockResolvedValue(subscriptionRow());

      const result = await service.getCurrentSubscription('clinic-a');

      expect(result.id).toBe('sub-a');
      expect(prisma.subscription.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clinicId: 'clinic-a', status: { not: 'SUPERSEDED' } },
        }),
      );
    });
  });

  describe('getSubscriptionHistory', () => {
    it('returns every row for the clinic, including superseded ones', async () => {
      const { service, prisma } = makeService();
      prisma.subscription.findMany.mockResolvedValue([
        subscriptionRow({ id: 'sub-b', status: 'ACTIVE' }),
        subscriptionRow({ id: 'sub-a', status: 'SUPERSEDED' }),
      ]);

      const result = await service.getSubscriptionHistory('clinic-a');

      expect(result.map((r) => r.id)).toEqual(['sub-b', 'sub-a']);
      expect(prisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { clinicId: 'clinic-a' } }),
      );
    });
  });

  describe('assignSubscription', () => {
    it('rejects assigning an inactive plan', async () => {
      const { service, plansService } = makeService();
      plansService.getPlanById.mockResolvedValue({ ...PLAN, status: 'INACTIVE' });

      await expect(
        service.assignSubscription('clinic-a', { planId: 'plan-a' }, 'admin-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects when the clinic already has a non-terminal subscription', async () => {
      const { service, prisma, plansService } = makeService();
      plansService.getPlanById.mockResolvedValue(PLAN);
      prisma.subscription.findFirst.mockResolvedValue(subscriptionRow());

      await expect(
        service.assignSubscription('clinic-a', { planId: 'plan-a' }, 'admin-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('creates an ACTIVE subscription for a plan with no trial, and audits it', async () => {
      const { prisma, auditService } = makeService();
      const plansService = { getPlanById: jest.fn().mockResolvedValue(PLAN) };
      const svc = new SubscriptionsService(
        prisma as unknown as PrismaService,
        {
          getClinicById: jest.fn().mockResolvedValue({ id: 'clinic-a' }),
        } as unknown as ClinicsService,
        plansService as unknown as PlansService,
        auditService as unknown as AuditService,
      );
      prisma.subscription.findFirst.mockResolvedValue(null);
      prisma.subscription.create.mockResolvedValue(subscriptionRow());

      const result = await svc.assignSubscription('clinic-a', { planId: 'plan-a' }, 'admin-1');

      expect(result.status).toBe('ACTIVE');
      /* eslint-disable @typescript-eslint/no-unsafe-assignment */
      expect(prisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clinicId: 'clinic-a',
            planId: 'plan-a',
            status: 'ACTIVE',
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: 'clinic-a',
          actorType: 'PLATFORM_USER',
          entity: 'Subscription',
          action: 'ASSIGN',
        }),
      );
    });

    it('creates a TRIAL subscription with a computed trialEndsAt for a plan with trialDays', async () => {
      const { service, prisma, plansService } = makeService();
      plansService.getPlanById.mockResolvedValue(TRIAL_PLAN);
      prisma.subscription.findFirst.mockResolvedValue(null);
      prisma.subscription.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...subscriptionRow(), ...data, plan: TRIAL_PLAN }),
      );

      await service.assignSubscription('clinic-a', { planId: 'plan-trial' }, 'admin-1');

      /* eslint-disable @typescript-eslint/no-unsafe-member-access */
      const call = prisma.subscription.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(call.data.status).toBe('TRIAL');
      expect(call.data.trialEndsAt).toBeInstanceOf(Date);
      /* eslint-enable @typescript-eslint/no-unsafe-member-access */
    });
  });

  describe('changePlan', () => {
    it('rejects changing to the same plan', async () => {
      const { service, prisma, plansService } = makeService();
      plansService.getPlanById.mockResolvedValue(PLAN);
      prisma.subscription.findFirst.mockResolvedValue(subscriptionRow({ planId: 'plan-a' }));

      await expect(service.changePlan('clinic-a', { planId: 'plan-a' }, 'admin-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('supersedes the current row and creates a new one, preserving history', async () => {
      const { service, prisma, plansService, auditService } = makeService();
      const newPlan = { ...PLAN, id: 'plan-b', name: 'Pro' };
      plansService.getPlanById.mockResolvedValue(newPlan);
      prisma.subscription.findFirst.mockResolvedValue(subscriptionRow({ id: 'sub-old' }));
      prisma.subscription.update.mockResolvedValue({});
      prisma.subscription.create.mockResolvedValue(
        subscriptionRow({ id: 'sub-new', planId: 'plan-b', plan: newPlan }),
      );

      const result = await service.changePlan('clinic-a', { planId: 'plan-b' }, 'admin-1');

      /* eslint-disable @typescript-eslint/no-unsafe-assignment */
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-old' },
          data: expect.objectContaining({ status: 'SUPERSEDED' }),
        }),
      );
      expect(prisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ planId: 'plan-b' }) }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      expect(result.id).toBe('sub-new');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CHANGE_PLAN', clinicId: 'clinic-a' }),
      );
    });
  });

  describe('activateSubscription / deactivateSubscription / cancelSubscription', () => {
    it('activates from SUSPENDED', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.subscription.findFirst.mockResolvedValue(subscriptionRow({ status: 'SUSPENDED' }));
      prisma.subscription.update.mockResolvedValue(subscriptionRow({ status: 'ACTIVE' }));

      await service.activateSubscription('clinic-a', 'admin-1');

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'ACTIVE' } }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ACTIVATE' }),
      );
    });

    it('rejects activating an already-cancelled subscription', async () => {
      const { service, prisma } = makeService();
      prisma.subscription.findFirst.mockResolvedValue(subscriptionRow({ status: 'CANCELLED' }));

      await expect(service.activateSubscription('clinic-a', 'admin-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('deactivates (suspends) an ACTIVE subscription', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.subscription.findFirst.mockResolvedValue(subscriptionRow({ status: 'ACTIVE' }));
      prisma.subscription.update.mockResolvedValue(subscriptionRow({ status: 'SUSPENDED' }));

      await service.deactivateSubscription('clinic-a', 'admin-1');

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'SUSPENDED' } }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEACTIVATE' }),
      );
    });

    it('cancels an ACTIVE subscription with a reason, and audits it', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.subscription.findFirst.mockResolvedValue(subscriptionRow({ status: 'ACTIVE' }));
      prisma.subscription.update.mockResolvedValue(subscriptionRow({ status: 'CANCELLED' }));

      await service.cancelSubscription(
        'clinic-a',
        { cancellationReason: 'Non-payment' },
        'admin-1',
      );

      /* eslint-disable @typescript-eslint/no-unsafe-assignment */
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CANCELLED',
            cancellationReason: 'Non-payment',
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CANCEL' }),
      );
    });

    it('rejects cancelling an already-cancelled subscription', async () => {
      const { service, prisma } = makeService();
      prisma.subscription.findFirst.mockResolvedValue(subscriptionRow({ status: 'CANCELLED' }));

      await expect(service.cancelSubscription('clinic-a', {}, 'admin-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('getCurrentPlanLimits', () => {
    it('returns null when the clinic has no current subscription', async () => {
      const { service, prisma } = makeService();
      prisma.subscription.findFirst.mockResolvedValue(null);

      expect(await service.getCurrentPlanLimits('clinic-a')).toBeNull();
    });

    it('returns the plan limits for the current subscription', async () => {
      const { service, prisma } = makeService();
      prisma.subscription.findFirst.mockResolvedValue(
        subscriptionRow({ plan: { ...PLAN, maxDoctors: 5, maxStaff: 10, maxPatients: 500 } }),
      );

      const result = await service.getCurrentPlanLimits('clinic-a');

      expect(result).toEqual(
        expect.objectContaining({
          clinicId: 'clinic-a',
          planId: 'plan-a',
          subscriptionStatus: 'ACTIVE',
          maxDoctors: 5,
          maxStaff: 10,
          maxPatients: 500,
        }),
      );
    });
  });

  describe('listAllCurrentPlanLimits', () => {
    it('excludes SUPERSEDED rows and resolves clinic names via the include', async () => {
      const { service, prisma } = makeService();
      prisma.subscription.findMany.mockResolvedValue([
        {
          ...subscriptionRow({ plan: { ...PLAN, maxDoctors: 5, maxStaff: 10, maxPatients: 500 } }),
          clinic: { id: 'clinic-a', name: 'Acme Clinic' },
        },
      ]);

      const result = await service.listAllCurrentPlanLimits({});

      expect(result).toEqual([
        expect.objectContaining({ clinicId: 'clinic-a', clinicName: 'Acme Clinic' }),
      ]);
      /* eslint-disable @typescript-eslint/no-unsafe-member-access */
      const call = prisma.subscription.findMany.mock.calls[0][0] as { where: { status: unknown } };
      expect(call.where.status).toEqual({ not: 'SUPERSEDED' });
      /* eslint-enable @typescript-eslint/no-unsafe-member-access */
    });
  });

  describe('listCurrentSubscriptions', () => {
    it('excludes SUPERSEDED rows by default and resolves clinic names', async () => {
      const { service, prisma } = makeService();
      prisma.subscription.count.mockResolvedValue(1);
      prisma.subscription.findMany.mockResolvedValue([subscriptionRow()]);
      prisma.clinic.findMany.mockResolvedValue([{ id: 'clinic-a', name: 'Acme Clinic' }]);

      const result = await service.listCurrentSubscriptions({ page: 1, pageSize: 20 });

      expect(result.data[0].clinic).toEqual({ id: 'clinic-a', name: 'Acme Clinic' });
      /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
      const call = prisma.subscription.findMany.mock.calls[0][0];
      expect(call.where.status).toEqual({ not: 'SUPERSEDED' });
      /* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
    });
  });
});
