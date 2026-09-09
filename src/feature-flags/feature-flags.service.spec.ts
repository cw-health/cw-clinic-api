import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from './feature-flags.service';

function makeService(overrides?: Partial<Record<string, unknown>>) {
  const prisma = {
    featureFlag: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    featureFlagOverride: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    ...overrides,
  };
  (prisma as Record<string, unknown>).$transaction = jest.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(prisma);
  });
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new FeatureFlagsService(
    prisma as unknown as PrismaService,
    auditService as unknown as AuditService,
  );
  return { service, prisma, auditService };
}

const GLOBAL_FLAG = {
  id: 'flag-global',
  key: 'new-billing-ui',
  name: 'New Billing UI',
  description: null,
  enabled: true,
  scope: 'GLOBAL',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const CLINIC_FLAG = {
  ...GLOBAL_FLAG,
  id: 'flag-clinic',
  key: 'ai-scribe',
  scope: 'CLINIC',
  enabled: false,
};

describe('FeatureFlagsService', () => {
  describe('evaluation', () => {
    it('isEnabledGlobally returns true for an enabled flag', async () => {
      const { service, prisma } = makeService();
      prisma.featureFlag.findUnique.mockResolvedValue(GLOBAL_FLAG);
      await expect(service.isEnabledGlobally('new-billing-ui')).resolves.toBe(true);
    });

    it('isEnabledGlobally returns false for a disabled flag', async () => {
      const { service, prisma } = makeService();
      prisma.featureFlag.findUnique.mockResolvedValue({ ...GLOBAL_FLAG, enabled: false });
      await expect(service.isEnabledGlobally('new-billing-ui')).resolves.toBe(false);
    });

    it('isEnabledGlobally fails closed for an unknown key', async () => {
      const { service, prisma } = makeService();
      prisma.featureFlag.findUnique.mockResolvedValue(null);
      await expect(service.isEnabledGlobally('does-not-exist')).resolves.toBe(false);
    });

    it('a GLOBAL-scope flag ignores any clinic override', async () => {
      const { service, prisma } = makeService();
      prisma.featureFlag.findUnique.mockResolvedValue(GLOBAL_FLAG);
      await expect(service.isEnabledForClinic('new-billing-ui', 'clinic-a')).resolves.toBe(true);
      expect(prisma.featureFlagOverride.findUnique).not.toHaveBeenCalled();
    });

    it('a CLINIC-scope flag with no override falls back to the global default', async () => {
      const { service, prisma } = makeService();
      prisma.featureFlag.findUnique.mockResolvedValue(CLINIC_FLAG);
      prisma.featureFlagOverride.findUnique.mockResolvedValue(null);
      await expect(service.isEnabledForClinic('ai-scribe', 'clinic-a')).resolves.toBe(false);
    });

    it("a CLINIC-scope flag's override wins over the global default", async () => {
      const { service, prisma } = makeService();
      prisma.featureFlag.findUnique.mockResolvedValue(CLINIC_FLAG);
      prisma.featureFlagOverride.findUnique.mockResolvedValue({ enabled: true });
      await expect(service.isEnabledForClinic('ai-scribe', 'clinic-a')).resolves.toBe(true);
    });

    it("tenant isolation: one clinic's override never affects another clinic's evaluation", async () => {
      const { service, prisma } = makeService();
      prisma.featureFlag.findUnique.mockResolvedValue(CLINIC_FLAG);
      prisma.featureFlagOverride.findUnique.mockImplementation(
        ({ where }: { where: { flagId_clinicId: { clinicId: string } } }) =>
          Promise.resolve(where.flagId_clinicId.clinicId === 'clinic-a' ? { enabled: true } : null),
      );

      await expect(service.isEnabledForClinic('ai-scribe', 'clinic-a')).resolves.toBe(true);
      await expect(service.isEnabledForClinic('ai-scribe', 'clinic-b')).resolves.toBe(false);
      expect(prisma.featureFlagOverride.findUnique).toHaveBeenCalledWith({
        where: { flagId_clinicId: { flagId: 'flag-clinic', clinicId: 'clinic-a' } },
      });
      expect(prisma.featureFlagOverride.findUnique).toHaveBeenCalledWith({
        where: { flagId_clinicId: { flagId: 'flag-clinic', clinicId: 'clinic-b' } },
      });
    });

    it('isEnabled dispatches to isEnabledForClinic for a tenant session', async () => {
      const { service, prisma } = makeService();
      prisma.featureFlag.findUnique.mockResolvedValue(CLINIC_FLAG);
      prisma.featureFlagOverride.findUnique.mockResolvedValue({ enabled: true });

      await expect(
        service.isEnabled('ai-scribe', { clinicId: 'clinic-a', isSuperAdmin: false }),
      ).resolves.toBe(true);
    });

    it('isEnabled falls back to the global default for a clinic-less SuperAdmin session', async () => {
      const { service, prisma } = makeService();
      prisma.featureFlag.findUnique.mockResolvedValue(GLOBAL_FLAG);

      await expect(
        service.isEnabled('new-billing-ui', { clinicId: null, isSuperAdmin: true }),
      ).resolves.toBe(true);
      expect(prisma.featureFlagOverride.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('createFlag', () => {
    it('rejects a duplicate key', async () => {
      const { service, prisma } = makeService();
      prisma.featureFlag.findUnique.mockResolvedValue(GLOBAL_FLAG);
      await expect(
        service.createFlag({ key: 'new-billing-ui', name: 'Dup' }, 'admin-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('creates the flag and records a platform-actor audit event', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.featureFlag.findUnique.mockResolvedValue(null);
      prisma.featureFlag.create.mockResolvedValue(GLOBAL_FLAG);

      const flag = await service.createFlag(
        { key: 'new-billing-ui', name: 'New Billing UI', enabled: true },
        'admin-1',
      );

      expect(flag.key).toBe('new-billing-ui');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: null,
          actorUserId: 'admin-1',
          actorType: 'PLATFORM_USER',
          entity: 'FeatureFlag',
          action: 'CREATE',
        }),
      );
    });
  });

  describe('updateFlag', () => {
    it('404s when the flag does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.featureFlag.findUnique.mockResolvedValue(null);
      await expect(service.updateFlag('missing', { name: 'X' }, 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updates and records an audit event', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.featureFlag.findUnique.mockResolvedValue(GLOBAL_FLAG);
      prisma.featureFlag.update.mockResolvedValue({ ...GLOBAL_FLAG, scope: 'CLINIC' });

      await service.updateFlag('flag-global', { scope: 'CLINIC' }, 'admin-1');

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', actorType: 'PLATFORM_USER', clinicId: null }),
      );
    });
  });

  describe('enableFlag / disableFlag', () => {
    it('enables and records an audit event', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.featureFlag.findUnique.mockResolvedValue({ ...GLOBAL_FLAG, enabled: false });
      prisma.featureFlag.update.mockResolvedValue({ ...GLOBAL_FLAG, enabled: true });

      const flag = await service.enableFlag('flag-global', 'admin-1');

      expect(flag.enabled).toBe(true);
      expect(prisma.featureFlag.update).toHaveBeenCalledWith({
        where: { id: 'flag-global' },
        data: { enabled: true },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ENABLE', actorType: 'PLATFORM_USER' }),
      );
    });

    it('disables and records an audit event', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.featureFlag.findUnique.mockResolvedValue({ ...GLOBAL_FLAG, enabled: true });
      prisma.featureFlag.update.mockResolvedValue({ ...GLOBAL_FLAG, enabled: false });

      const flag = await service.disableFlag('flag-global', 'admin-1');

      expect(flag.enabled).toBe(false);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DISABLE', actorType: 'PLATFORM_USER' }),
      );
    });
  });

  describe('setClinicOverride', () => {
    it('rejects configuring an override on a GLOBAL-scope flag', async () => {
      const { service, prisma } = makeService();
      prisma.featureFlag.findUnique.mockResolvedValue(GLOBAL_FLAG);

      await expect(
        service.setClinicOverride('flag-global', 'clinic-a', { enabled: true }, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.featureFlagOverride.upsert).not.toHaveBeenCalled();
    });

    it('upserts an override on a CLINIC-scope flag and records a clinic-attributed audit event', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.featureFlag.findUnique.mockResolvedValue(CLINIC_FLAG);
      prisma.featureFlagOverride.upsert.mockResolvedValue({});

      await service.setClinicOverride('flag-clinic', 'clinic-a', { enabled: true }, 'admin-1');

      expect(prisma.featureFlagOverride.upsert).toHaveBeenCalledWith({
        where: { flagId_clinicId: { flagId: 'flag-clinic', clinicId: 'clinic-a' } },
        create: { flagId: 'flag-clinic', clinicId: 'clinic-a', enabled: true },
        update: { enabled: true },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: 'clinic-a',
          actorType: 'PLATFORM_USER',
          entity: 'FeatureFlagOverride',
          action: 'SET_OVERRIDE',
        }),
      );
    });
  });

  describe('removeClinicOverride', () => {
    it('404s when no override exists for that clinic', async () => {
      const { service, prisma } = makeService();
      prisma.featureFlag.findUnique.mockResolvedValue(CLINIC_FLAG);
      prisma.featureFlagOverride.findUnique.mockResolvedValue(null);

      await expect(
        service.removeClinicOverride('flag-clinic', 'clinic-a', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('removes the override and records an audit event', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.featureFlag.findUnique.mockResolvedValue(CLINIC_FLAG);
      prisma.featureFlagOverride.findUnique.mockResolvedValue({ id: 'override-1' });

      await service.removeClinicOverride('flag-clinic', 'clinic-a', 'admin-1');

      expect(prisma.featureFlagOverride.delete).toHaveBeenCalledWith({
        where: { id: 'override-1' },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: 'clinic-a',
          entity: 'FeatureFlagOverride',
          action: 'REMOVE_OVERRIDE',
        }),
      );
    });
  });

  describe('listFlags', () => {
    it('paginates and filters by scope/enabled/search', async () => {
      const { service, prisma } = makeService();
      prisma.featureFlag.count.mockResolvedValue(1);
      prisma.featureFlag.findMany.mockResolvedValue([GLOBAL_FLAG]);

      const result = await service.listFlags({
        page: 1,
        pageSize: 20,
        scope: 'GLOBAL',
        enabled: true,
      });

      expect(result.meta).toEqual({ total: 1, page: 1, pageSize: 20 });
      expect(result.data).toEqual([expect.objectContaining({ key: 'new-billing-ui' })]);
      /* eslint-disable @typescript-eslint/no-unsafe-assignment */
      expect(prisma.featureFlag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ scope: 'GLOBAL', enabled: true }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });
  });
});
