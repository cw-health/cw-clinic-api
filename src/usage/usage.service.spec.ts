import type { ClinicsService } from '../clinics/clinics.service';
import type { DoctorsService } from '../doctors/doctors.service';
import type { PatientsService } from '../patients/patients.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { UsageService } from './usage.service';

function makeService(overrides?: {
  prisma?: Partial<Record<string, unknown>>;
  clinicsService?: Partial<Record<string, unknown>>;
  doctorsService?: Partial<Record<string, unknown>>;
  patientsService?: Partial<Record<string, unknown>>;
  subscriptionsService?: Partial<Record<string, unknown>>;
}) {
  const prisma = {
    clinicMembership: {
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    ...overrides?.prisma,
  };
  const clinicsService = {
    getClinicById: jest.fn().mockResolvedValue({ id: 'clinic-a', name: 'Acme Clinic' }),
    ...overrides?.clinicsService,
  };
  const doctorsService = {
    countActive: jest.fn().mockResolvedValue(0),
    countActiveGroupedByClinic: jest.fn().mockResolvedValue(new Map()),
    ...overrides?.doctorsService,
  };
  const patientsService = {
    countActive: jest.fn().mockResolvedValue(0),
    countActiveGroupedByClinic: jest.fn().mockResolvedValue(new Map()),
    ...overrides?.patientsService,
  };
  const subscriptionsService = {
    getCurrentPlanLimits: jest.fn().mockResolvedValue(null),
    listAllCurrentPlanLimits: jest.fn().mockResolvedValue([]),
    ...overrides?.subscriptionsService,
  };

  const service = new UsageService(
    prisma as unknown as PrismaService,
    clinicsService as unknown as ClinicsService,
    doctorsService as unknown as DoctorsService,
    patientsService as unknown as PatientsService,
    subscriptionsService as unknown as SubscriptionsService,
  );
  return { service, prisma, clinicsService, doctorsService, patientsService, subscriptionsService };
}

describe('UsageService', () => {
  describe('getClinicUsage', () => {
    it('marks a resource over limit when usage exceeds the plan limit', async () => {
      const { service } = makeService({
        subscriptionsService: {
          getCurrentPlanLimits: jest.fn().mockResolvedValue({
            clinicId: 'clinic-a',
            clinicName: 'Acme Clinic',
            subscriptionStatus: 'ACTIVE',
            planId: 'plan-a',
            planName: 'Starter',
            maxDoctors: 2,
            maxStaff: 5,
            maxPatients: 100,
          }),
        },
        doctorsService: { countActive: jest.fn().mockResolvedValue(3) },
        patientsService: { countActive: jest.fn().mockResolvedValue(50) },
        prisma: { clinicMembership: { count: jest.fn().mockResolvedValue(2) } },
      });

      const result = await service.getClinicUsage('clinic-a');

      const doctors = result.resources.find((r) => r.resource === 'DOCTORS');
      expect(doctors).toEqual({
        resource: 'DOCTORS',
        currentUsage: 3,
        limit: 2,
        utilizationPercent: 150,
        overLimit: true,
      });
      expect(result.overLimitAny).toBe(true);
      expect(result.planName).toBe('Starter');
    });

    it('treats a null limit as unlimited (never over limit, no percentage)', async () => {
      const { service } = makeService({
        subscriptionsService: {
          getCurrentPlanLimits: jest.fn().mockResolvedValue({
            clinicId: 'clinic-a',
            clinicName: 'Acme Clinic',
            subscriptionStatus: 'ACTIVE',
            planId: 'plan-a',
            planName: 'Enterprise',
            maxDoctors: null,
            maxStaff: null,
            maxPatients: null,
          }),
        },
        doctorsService: { countActive: jest.fn().mockResolvedValue(1000) },
      });

      const result = await service.getClinicUsage('clinic-a');

      const doctors = result.resources.find((r) => r.resource === 'DOCTORS');
      expect(doctors?.limit).toBeNull();
      expect(doctors?.utilizationPercent).toBeNull();
      expect(doctors?.overLimit).toBe(false);
      expect(result.overLimitAny).toBe(false);
    });

    it('reports a clinic with no subscription as having no plan, not an error', async () => {
      const { service } = makeService();

      const result = await service.getClinicUsage('clinic-a');

      expect(result.planId).toBeNull();
      expect(result.subscriptionStatus).toBeNull();
      expect(result.resources.every((r) => r.limit === null && !r.overLimit)).toBe(true);
    });
  });

  describe('getOverview', () => {
    const planLimitsRow = (overrides?: Partial<Record<string, unknown>>) => ({
      clinicId: 'clinic-a',
      clinicName: 'Acme Clinic',
      subscriptionStatus: 'ACTIVE',
      planId: 'plan-a',
      planName: 'Starter',
      maxDoctors: 2,
      maxStaff: 5,
      maxPatients: 100,
      ...overrides,
    });

    it('filters to only over-limit clinics when overLimitOnly is set', async () => {
      const { service } = makeService({
        subscriptionsService: {
          listAllCurrentPlanLimits: jest
            .fn()
            .mockResolvedValue([
              planLimitsRow({ clinicId: 'clinic-a' }),
              planLimitsRow({ clinicId: 'clinic-b' }),
            ]),
        },
        doctorsService: {
          countActiveGroupedByClinic: jest.fn().mockResolvedValue(
            new Map([
              ['clinic-a', 3],
              ['clinic-b', 1],
            ]),
          ),
        },
      });

      const result = await service.getOverview({ overLimitOnly: true });

      expect(result.data.map((row) => row.clinicId)).toEqual(['clinic-a']);
      expect(result.meta.total).toBe(1);
    });

    it('sorts by worst utilization percent descending by default', async () => {
      const { service } = makeService({
        subscriptionsService: {
          listAllCurrentPlanLimits: jest
            .fn()
            .mockResolvedValue([
              planLimitsRow({ clinicId: 'clinic-low', maxDoctors: 10 }),
              planLimitsRow({ clinicId: 'clinic-high', maxDoctors: 10 }),
            ]),
        },
        doctorsService: {
          countActiveGroupedByClinic: jest.fn().mockResolvedValue(
            new Map([
              ['clinic-low', 1],
              ['clinic-high', 9],
            ]),
          ),
        },
      });

      const result = await service.getOverview({});

      expect(result.data.map((row) => row.clinicId)).toEqual(['clinic-high', 'clinic-low']);
    });

    it('paginates the computed, filtered result set', async () => {
      const { service } = makeService({
        subscriptionsService: {
          listAllCurrentPlanLimits: jest
            .fn()
            .mockResolvedValue([
              planLimitsRow({ clinicId: 'clinic-a' }),
              planLimitsRow({ clinicId: 'clinic-b' }),
              planLimitsRow({ clinicId: 'clinic-c' }),
            ]),
        },
      });

      const result = await service.getOverview({ page: 2, pageSize: 2 });

      expect(result.meta).toEqual({ total: 3, page: 2, pageSize: 2 });
      expect(result.data).toHaveLength(1);
    });
  });
});
