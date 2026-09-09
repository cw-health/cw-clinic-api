import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { DocumentStorageProvider } from '../documents/storage-providers/document-storage-provider.interface';
import type { PrismaService } from '../prisma/prisma.service';
import { ClinicsService } from './clinics.service';

const BASE_CLINIC = {
  id: 'clinic-a',
  name: 'Riverside',
  slug: 'riverside',
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
  primaryAdminUser: null,
  invoiceSequence: 0,
  receiptSequence: 0,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function makeService(overrides?: Partial<Record<string, unknown>>) {
  const prisma = {
    clinic: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    clinicWorkingHours: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    clinicHoliday: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    role: {
      findFirst: jest.fn().mockResolvedValue({ id: 'role-clinic-admin' }),
    },
    clinicMembership: {
      create: jest.fn(),
    },
    clinicDocument: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    ...overrides,
  };
  (prisma as Record<string, unknown>).$transaction = jest.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)(prisma);
  });
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const storage: DocumentStorageProvider = {
    save: jest.fn().mockResolvedValue(undefined),
    read: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ClinicsService(
    prisma as unknown as PrismaService,
    auditService as unknown as AuditService,
    storage,
  );
  return { service, prisma, auditService, storage };
}

describe('ClinicsService', () => {
  describe('getOwnClinic', () => {
    it('404s when the clinic does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.findUnique.mockResolvedValue(null);
      await expect(service.getOwnClinic('clinic-a')).rejects.toThrow(NotFoundException);
    });

    it('scopes the lookup by the caller clinicId only, including the primary admin summary', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.findUnique.mockResolvedValue({ ...BASE_CLINIC });
      const clinic = await service.getOwnClinic('clinic-a');

      expect(prisma.clinic.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'clinic-a' } }),
      );
      expect(clinic.id).toBe('clinic-a');
      // Internal counters never leak into the tenant-facing profile shape.
      expect((clinic as unknown as { invoiceSequence?: number }).invoiceSequence).toBeUndefined();
    });
  });

  describe('setWorkingHours validation', () => {
    it('rejects a duplicate dayOfWeek', async () => {
      const { service } = makeService();
      await expect(
        service.setWorkingHours(
          'clinic-a',
          {
            days: [
              { dayOfWeek: 1, isOpen: true, openTime: '09:00', closeTime: '17:00' },
              { dayOfWeek: 1, isOpen: true, openTime: '09:00', closeTime: '17:00' },
            ],
          },
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects an open day missing openTime/closeTime', async () => {
      const { service } = makeService();
      await expect(
        service.setWorkingHours('clinic-a', { days: [{ dayOfWeek: 1, isOpen: true }] }, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects openTime >= closeTime', async () => {
      const { service } = makeService();
      await expect(
        service.setWorkingHours(
          'clinic-a',
          { days: [{ dayOfWeek: 1, isOpen: true, openTime: '17:00', closeTime: '09:00' }] },
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('persists a closed day with null times and records an audit event', async () => {
      const { service, prisma, auditService } = makeService();
      await service.setWorkingHours(
        'clinic-a',
        { days: [{ dayOfWeek: 0, isOpen: false }] },
        'user-1',
      );

      expect(prisma.clinicWorkingHours.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({ clinicId: 'clinic-a', openTime: null, closeTime: null }),
          ],
        }),
      );
      // `changedFields` is a day count, never the actual opening/closing times.
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: 'clinic-a',
          actorUserId: 'user-1',
          entity: 'ClinicWorkingHours',
          action: 'UPDATE',
          changedFields: 'days:1',
        }),
      );
    });
  });

  describe('holidays (tenant isolation)', () => {
    it('rejects a duplicate holiday date for the same clinic', async () => {
      const { service, prisma } = makeService();
      prisma.clinicHoliday.findUnique.mockResolvedValue({ id: 'holiday-1' });
      await expect(
        service.addHoliday('clinic-a', { date: '2026-12-25', name: 'Christmas' }, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('records an audit event when a holiday is added', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.clinicHoliday.create.mockResolvedValue({ id: 'holiday-1', clinicId: 'clinic-a' });
      await service.addHoliday('clinic-a', { date: '2026-12-25', name: 'Christmas' }, 'user-1');

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: 'clinic-a',
          actorUserId: 'user-1',
          entity: 'ClinicHoliday',
          entityId: 'holiday-1',
          action: 'CREATE',
        }),
      );
    });

    it('removeHoliday 404s for a holiday belonging to another clinic', async () => {
      const { service, prisma } = makeService();
      prisma.clinicHoliday.findFirst.mockResolvedValue(null);
      await expect(service.removeHoliday('clinic-b', 'holiday-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(prisma.clinicHoliday.findFirst).toHaveBeenCalledWith({
        where: { id: 'holiday-1', clinicId: 'clinic-b' },
      });
    });

    it('records an audit event when a holiday is removed', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.clinicHoliday.findFirst.mockResolvedValue({ id: 'holiday-1', clinicId: 'clinic-a' });
      await service.removeHoliday('clinic-a', 'holiday-1', 'user-1');

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: 'clinic-a',
          actorUserId: 'user-1',
          entity: 'ClinicHoliday',
          entityId: 'holiday-1',
          action: 'DELETE',
        }),
      );
    });
  });

  describe('updateOwnClinic (ClinicAdmin self-service)', () => {
    it('404s when the clinic does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.findUnique.mockResolvedValue(null);
      await expect(
        service.updateOwnClinic('clinic-a', { contactEmail: 'a@example.com' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('applies the patch, recomputes onboarding, and audits a TENANT_USER update', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.clinic.findUnique.mockResolvedValue({ ...BASE_CLINIC });
      prisma.clinic.update.mockResolvedValue({
        ...BASE_CLINIC,
        contactEmail: 'clinic@example.com',
        onboardingStatus: 'IN_PROGRESS',
      });

      const clinic = await service.updateOwnClinic(
        'clinic-a',
        { contactEmail: 'clinic@example.com' },
        'user-1',
      );

      expect(clinic.onboardingStatus).toBe('IN_PROGRESS');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: 'clinic-a',
          actorUserId: 'user-1',
          actorType: 'TENANT_USER',
          entity: 'Clinic',
          action: 'UPDATE',
        }),
      );
    });

    it('fires ONBOARDING_STARTED exactly once, the first time a NOT_STARTED clinic progresses', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.clinic.findUnique.mockResolvedValue({
        ...BASE_CLINIC,
        onboardingStatus: 'NOT_STARTED',
      });
      prisma.clinic.update.mockResolvedValue({
        ...BASE_CLINIC,
        contactEmail: 'clinic@example.com',
        onboardingStatus: 'IN_PROGRESS',
      });

      await service.updateOwnClinic('clinic-a', { contactEmail: 'clinic@example.com' }, 'user-1');

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ONBOARDING_STARTED', actorType: 'TENANT_USER' }),
      );
    });

    it('does not re-fire ONBOARDING_STARTED once already IN_PROGRESS', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.clinic.findUnique.mockResolvedValue({
        ...BASE_CLINIC,
        contactEmail: 'clinic@example.com',
        onboardingStatus: 'IN_PROGRESS',
      });
      prisma.clinic.update.mockResolvedValue({
        ...BASE_CLINIC,
        contactEmail: 'clinic@example.com',
        addressLine1: '1 Main St',
        onboardingStatus: 'IN_PROGRESS',
      });

      await service.updateOwnClinic('clinic-a', { addressLine1: '1 Main St' }, 'user-1');

      expect(auditService.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ONBOARDING_STARTED' }),
      );
    });

    it('existing-clinic compatibility: a pre-Phase-1A COMPLETED clinic stays COMPLETED after an unrelated patch', async () => {
      const { service, prisma } = makeService();
      const complete = {
        ...BASE_CLINIC,
        contactEmail: 'clinic@example.com',
        addressLine1: '1 Main St',
        city: 'Springfield',
        country: 'USA',
        legalEntityType: 'PRIVATE_COMPANY',
        registrationApplicable: false,
        primaryAdminUserId: 'user-1',
        primaryAdminUser: { id: 'user-1', firstName: 'A', lastName: 'B', email: 'a@example.com' },
        onboardingStatus: 'COMPLETED',
        onboardingCompletedAt: new Date('2026-01-01T00:00:00Z'),
        // Fields this test's clinic predates (Phase 1A) — never set, must
        // not be required for staying COMPLETED.
        facilityType: null,
      };
      prisma.clinic.findUnique.mockResolvedValue(complete);
      prisma.clinic.update.mockResolvedValue({ ...complete, website: 'https://example.com' });

      const clinic = await service.updateOwnClinic(
        'clinic-a',
        { website: 'https://example.com' },
        'user-1',
      );

      expect(clinic.onboardingStatus).toBe('COMPLETED');
      expect(clinic.missingRequiredFields).toEqual([]);
    });
  });

  describe('onboarding wizard (tenant self-service, Phase 1A)', () => {
    it('getOnboardingStatus reports each step and the first incomplete one as currentStep', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.findUnique.mockResolvedValue({
        ...BASE_CLINIC,
        contactEmail: 'clinic@example.com',
        onboardingStatus: 'IN_PROGRESS',
      });
      prisma.clinicWorkingHours.count.mockResolvedValue(0);

      const status = await service.getOnboardingStatus('clinic-a');

      expect(status.onboardingStatus).toBe('IN_PROGRESS');
      expect(status.steps).toEqual([
        { key: 'BASIC_INFO', label: 'Hospital information', completed: true },
        { key: 'LEGAL_INFO', label: 'Legal information', completed: false },
        { key: 'ADDRESS', label: 'Address', completed: false },
        { key: 'WORKING_HOURS', label: 'Working hours', completed: false },
        { key: 'PRIMARY_ADMIN', label: 'Primary administrator', completed: false },
      ]);
      expect(status.currentStep).toBe('LEGAL_INFO');
    });

    it('getOnboardingStatus reports currentStep REVIEW once every step is complete', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.findUnique.mockResolvedValue({
        ...BASE_CLINIC,
        contactEmail: 'clinic@example.com',
        addressLine1: '1 Main St',
        city: 'Springfield',
        country: 'USA',
        legalEntityType: 'PRIVATE_COMPANY',
        registrationApplicable: false,
        primaryAdminUserId: 'user-1',
        primaryAdminUser: { id: 'user-1', firstName: 'A', lastName: 'B', email: 'a@example.com' },
        onboardingStatus: 'COMPLETED',
      });
      prisma.clinicWorkingHours.count.mockResolvedValue(7);

      const status = await service.getOnboardingStatus('clinic-a');

      expect(status.currentStep).toBe('REVIEW');
      expect(status.steps.every((s) => s.completed)).toBe(true);
    });

    it('updateOnboardingBasicInfo/LegalInfo/Address only ever touch their own fields (whitelisted subset)', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.findUnique.mockResolvedValue({ ...BASE_CLINIC });
      prisma.clinic.update.mockResolvedValue({ ...BASE_CLINIC });

      await service.updateOnboardingLegalInfo(
        'clinic-a',
        { legalEntityType: 'LLP', registrationApplicable: false },
        'user-1',
      );

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.clinic.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            legalEntityType: 'LLP',
            registrationApplicable: false,
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    describe('assignSelfAsPrimaryAdmin', () => {
      it('sets the calling user as primary admin when none is set yet', async () => {
        const { service, prisma, auditService } = makeService();
        prisma.clinic.findUnique.mockResolvedValue({ ...BASE_CLINIC });
        prisma.clinic.update.mockResolvedValue({
          ...BASE_CLINIC,
          primaryAdminUserId: 'user-1',
          primaryAdminUser: { id: 'user-1', firstName: 'A', lastName: 'B', email: 'a@example.com' },
          onboardingStatus: 'IN_PROGRESS',
        });

        const clinic = await service.assignSelfAsPrimaryAdmin('clinic-a', 'user-1');

        expect(clinic.primaryAdmin?.id).toBe('user-1');
        expect(auditService.record).toHaveBeenCalledWith(
          expect.objectContaining({
            changedFields: 'primaryAdminUserId',
            actorType: 'TENANT_USER',
          }),
        );
      });

      it('is idempotent when the caller is already the primary admin', async () => {
        const { service, prisma } = makeService();
        prisma.clinic.findUnique.mockResolvedValue({
          ...BASE_CLINIC,
          primaryAdminUserId: 'user-1',
          primaryAdminUser: { id: 'user-1', firstName: 'A', lastName: 'B', email: 'a@example.com' },
        });

        const clinic = await service.assignSelfAsPrimaryAdmin('clinic-a', 'user-1');

        expect(clinic.primaryAdmin?.id).toBe('user-1');
        expect(prisma.clinic.update).not.toHaveBeenCalled();
      });

      it('rejects when another user is already the primary admin (cross-user takeover)', async () => {
        const { service, prisma } = makeService();
        prisma.clinic.findUnique.mockResolvedValue({
          ...BASE_CLINIC,
          primaryAdminUserId: 'user-existing',
        });

        await expect(service.assignSelfAsPrimaryAdmin('clinic-a', 'user-2')).rejects.toThrow(
          ConflictException,
        );
      });
    });

    describe('completeOnboarding', () => {
      it('rejects with the itemized missing-fields list when incomplete', async () => {
        const { service, prisma } = makeService();
        prisma.clinic.findUnique.mockResolvedValue({ ...BASE_CLINIC });

        await expect(service.completeOnboarding('clinic-a', 'user-1')).rejects.toThrow(
          BadRequestException,
        );
      });

      it('completes and audits ONBOARDING_COMPLETED when every required field is present', async () => {
        const { service, prisma, auditService } = makeService();
        const complete = {
          ...BASE_CLINIC,
          contactEmail: 'clinic@example.com',
          addressLine1: '1 Main St',
          city: 'Springfield',
          country: 'USA',
          legalEntityType: 'PRIVATE_COMPANY',
          registrationApplicable: false,
          primaryAdminUserId: 'user-1',
          primaryAdminUser: { id: 'user-1', firstName: 'A', lastName: 'B', email: 'a@example.com' },
        };
        prisma.clinic.findUnique.mockResolvedValue(complete);
        prisma.clinic.update.mockResolvedValue({ ...complete, onboardingStatus: 'COMPLETED' });

        const clinic = await service.completeOnboarding('clinic-a', 'user-1');

        expect(clinic.onboardingStatus).toBe('COMPLETED');
        expect(auditService.record).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'ONBOARDING_COMPLETED', actorType: 'TENANT_USER' }),
        );
      });

      it('is idempotent (no duplicate audit event) when already COMPLETED', async () => {
        const { service, prisma, auditService } = makeService();
        const complete = {
          ...BASE_CLINIC,
          contactEmail: 'clinic@example.com',
          addressLine1: '1 Main St',
          city: 'Springfield',
          country: 'USA',
          legalEntityType: 'PRIVATE_COMPANY',
          registrationApplicable: false,
          primaryAdminUserId: 'user-1',
          primaryAdminUser: { id: 'user-1', firstName: 'A', lastName: 'B', email: 'a@example.com' },
          onboardingStatus: 'COMPLETED',
          onboardingCompletedAt: new Date('2026-01-01T00:00:00Z'),
        };
        prisma.clinic.findUnique.mockResolvedValue(complete);

        const clinic = await service.completeOnboarding('clinic-a', 'user-1');

        expect(clinic.onboardingStatus).toBe('COMPLETED');
        expect(prisma.clinic.update).not.toHaveBeenCalled();
        expect(auditService.record).not.toHaveBeenCalled();
      });
    });
  });

  describe('createClinic (Super Admin registry)', () => {
    it('rejects a duplicate slug', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.findUnique.mockResolvedValue({ id: 'clinic-a' });
      await expect(
        service.createClinic({ name: 'Riverside', slug: 'riverside' }, 'admin-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('creates a bare clinic as NOT_STARTED and records a platform-actor audit event', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.clinic.findUnique.mockResolvedValue(null);
      prisma.clinic.create.mockResolvedValue({ ...BASE_CLINIC });
      prisma.clinic.update.mockResolvedValue({ ...BASE_CLINIC });

      const clinic = await service.createClinic(
        { name: 'Riverside', slug: 'riverside' },
        'admin-1',
      );

      expect(clinic.id).toBe('clinic-a');
      expect(clinic.onboardingStatus).toBe('NOT_STARTED');
      expect(clinic.missingRequiredFields).toEqual(
        expect.arrayContaining(['contactEmail', 'address', 'legalEntityType', 'primaryAdmin']),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: 'clinic-a',
          actorUserId: 'admin-1',
          actorType: 'PLATFORM_USER',
          entity: 'Clinic',
          action: 'CREATE',
        }),
      );
    });

    it('rejects when primaryAdmin.email is already in use', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expect(
        service.createClinic(
          {
            name: 'Riverside',
            slug: 'riverside',
            primaryAdmin: {
              email: 'taken@example.com',
              firstName: 'A',
              lastName: 'B',
              temporaryPassword: 'password123',
            },
          },
          'admin-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects when the ClinicAdmin role template is not seeded', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.findUnique.mockResolvedValue(null);
      prisma.role.findFirst.mockResolvedValue(null);

      await expect(
        service.createClinic(
          {
            name: 'Riverside',
            slug: 'riverside',
            primaryAdmin: {
              email: 'admin@example.com',
              firstName: 'A',
              lastName: 'B',
              temporaryPassword: 'password123',
            },
          },
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates the clinic, the primary admin user, and a ClinicAdmin membership together', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.findUnique.mockResolvedValue(null);
      prisma.clinic.create.mockResolvedValue({ ...BASE_CLINIC });
      prisma.user.create.mockResolvedValue({ id: 'user-1' });
      prisma.clinic.update.mockResolvedValue({
        ...BASE_CLINIC,
        primaryAdminUserId: 'user-1',
        primaryAdminUser: { id: 'user-1', firstName: 'A', lastName: 'B', email: 'a@example.com' },
        onboardingStatus: 'IN_PROGRESS',
      });

      const clinic = await service.createClinic(
        {
          name: 'Riverside',
          slug: 'riverside',
          primaryAdmin: {
            email: 'a@example.com',
            firstName: 'A',
            lastName: 'B',
            temporaryPassword: 'password123',
          },
        },
        'admin-1',
      );

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.clinicMembership.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            clinicId: 'clinic-a',
            roleId: 'role-clinic-admin',
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      expect(clinic.primaryAdmin).toEqual({
        id: 'user-1',
        firstName: 'A',
        lastName: 'B',
        email: 'a@example.com',
      });
    });

    it('reaches onboardingStatus COMPLETED once every required field is present', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.findUnique.mockResolvedValue(null);
      const complete = {
        ...BASE_CLINIC,
        contactEmail: 'clinic@example.com',
        addressLine1: '1 Main St',
        city: 'Springfield',
        country: 'USA',
        legalEntityType: 'PRIVATE_COMPANY',
        registrationNumber: 'REG-12345',
        primaryAdminUserId: 'user-1',
        primaryAdminUser: { id: 'user-1', firstName: 'A', lastName: 'B', email: 'a@example.com' },
      };
      prisma.clinic.create.mockResolvedValue(complete);
      prisma.user.create.mockResolvedValue({ id: 'user-1' });
      prisma.clinic.update.mockResolvedValue({ ...complete, onboardingStatus: 'COMPLETED' });

      const clinic = await service.createClinic(
        {
          name: 'Riverside',
          slug: 'riverside',
          contactEmail: 'clinic@example.com',
          addressLine1: '1 Main St',
          city: 'Springfield',
          country: 'USA',
          legalEntityType: 'PRIVATE_COMPANY',
          registrationNumber: 'REG-12345',
          primaryAdmin: {
            email: 'a@example.com',
            firstName: 'A',
            lastName: 'B',
            temporaryPassword: 'password123',
          },
        },
        'admin-1',
      );

      expect(clinic.onboardingStatus).toBe('COMPLETED');
      expect(clinic.missingRequiredFields).toEqual([]);
    });

    it('does not require registrationNumber when registrationApplicable is false', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.findUnique.mockResolvedValue(null);
      const clinicRow = {
        ...BASE_CLINIC,
        contactEmail: 'clinic@example.com',
        addressLine1: '1 Main St',
        city: 'Springfield',
        country: 'USA',
        legalEntityType: 'INDIVIDUAL_PRACTITIONER',
        registrationApplicable: false,
        primaryAdminUserId: 'user-1',
        primaryAdminUser: { id: 'user-1', firstName: 'A', lastName: 'B', email: 'a@example.com' },
      };
      prisma.clinic.create.mockResolvedValue(clinicRow);
      prisma.user.create.mockResolvedValue({ id: 'user-1' });
      prisma.clinic.update.mockResolvedValue({ ...clinicRow, onboardingStatus: 'COMPLETED' });

      const clinic = await service.createClinic(
        {
          name: 'Solo Practice',
          slug: 'solo-practice',
          registrationApplicable: false,
          contactEmail: 'clinic@example.com',
          addressLine1: '1 Main St',
          city: 'Springfield',
          country: 'USA',
          legalEntityType: 'INDIVIDUAL_PRACTITIONER',
          primaryAdmin: {
            email: 'a@example.com',
            firstName: 'A',
            lastName: 'B',
            temporaryPassword: 'password123',
          },
        },
        'admin-1',
      );

      expect(clinic.onboardingStatus).toBe('COMPLETED');
    });
  });

  describe('updateClinicAdmin (Super Admin registry)', () => {
    it('404s when the clinic does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.findUnique.mockResolvedValue(null);
      await expect(
        service.updateClinicAdmin('clinic-a', { name: 'New name' }, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects renaming the slug to one already in use by another clinic', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.findUnique
        .mockResolvedValueOnce({ ...BASE_CLINIC }) // getClinicRowOrThrow
        .mockResolvedValueOnce({ id: 'clinic-b' }); // slug collision lookup
      await expect(
        service.updateClinicAdmin('clinic-a', { slug: 'taken' }, 'admin-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('recomputes onboarding status and records an audit event', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.clinic.findUnique.mockResolvedValue({ ...BASE_CLINIC });
      prisma.clinic.update.mockResolvedValue({
        ...BASE_CLINIC,
        contactEmail: 'clinic@example.com',
        onboardingStatus: 'IN_PROGRESS',
      });

      const clinic = await service.updateClinicAdmin(
        'clinic-a',
        { contactEmail: 'clinic@example.com' },
        'admin-1',
      );

      expect(clinic.onboardingStatus).toBe('IN_PROGRESS');
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.clinic.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'clinic-a' },
          data: expect.objectContaining({
            contactEmail: 'clinic@example.com',
            onboardingStatus: 'IN_PROGRESS',
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', actorType: 'PLATFORM_USER' }),
      );
    });

    it('does not blank out onboarding-relevant fields the PATCH body simply omits (regression)', async () => {
      // A clinic that's already onboarding-COMPLETED, patched with a field
      // the checklist doesn't care about — merging must not treat the
      // untouched checklist fields (registrationApplicable/registrationNumber/
      // etc.) as newly-missing just because this DTO instance carries them
      // as `undefined`.
      const { service, prisma } = makeService();
      const complete = {
        ...BASE_CLINIC,
        contactEmail: 'clinic@example.com',
        addressLine1: '1 Main St',
        city: 'Springfield',
        country: 'USA',
        legalEntityType: 'PRIVATE_COMPANY',
        registrationApplicable: false,
        registrationNumber: null,
        primaryAdminUserId: 'user-1',
        primaryAdminUser: { id: 'user-1', firstName: 'A', lastName: 'B', email: 'a@example.com' },
        onboardingStatus: 'COMPLETED',
        onboardingCompletedAt: new Date('2026-01-01T00:00:00Z'),
      };
      prisma.clinic.findUnique.mockResolvedValue(complete);
      prisma.clinic.update.mockResolvedValue({ ...complete, description: 'updated' });

      const clinic = await service.updateClinicAdmin(
        'clinic-a',
        { description: 'updated' },
        'admin-1',
      );

      expect(clinic.onboardingStatus).toBe('COMPLETED');
      expect(clinic.missingRequiredFields).toEqual([]);
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.clinic.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ onboardingStatus: 'COMPLETED' }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });
  });

  describe('assignPrimaryAdmin (Super Admin registry)', () => {
    it('404s when the clinic does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.findUnique.mockResolvedValue(null);
      await expect(
        service.assignPrimaryAdmin(
          'clinic-a',
          {
            email: 'a@example.com',
            firstName: 'A',
            lastName: 'B',
            temporaryPassword: 'password123',
          },
          'admin-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the clinic already has a primary administrator', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.findUnique.mockResolvedValue({
        ...BASE_CLINIC,
        primaryAdminUserId: 'user-existing',
      });

      await expect(
        service.assignPrimaryAdmin(
          'clinic-a',
          {
            email: 'a@example.com',
            firstName: 'A',
            lastName: 'B',
            temporaryPassword: 'password123',
          },
          'admin-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a duplicate email', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.findUnique.mockResolvedValue({ ...BASE_CLINIC });
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expect(
        service.assignPrimaryAdmin(
          'clinic-a',
          {
            email: 'a@example.com',
            firstName: 'A',
            lastName: 'B',
            temporaryPassword: 'password123',
          },
          'admin-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('creates the user, membership, and sets primaryAdminUserId, and audits ASSIGN_PRIMARY_ADMIN', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.clinic.findUnique.mockResolvedValue({ ...BASE_CLINIC });
      prisma.user.create.mockResolvedValue({ id: 'user-1' });
      prisma.clinic.update.mockResolvedValue({
        ...BASE_CLINIC,
        primaryAdminUserId: 'user-1',
        primaryAdminUser: { id: 'user-1', firstName: 'A', lastName: 'B', email: 'a@example.com' },
      });

      const clinic = await service.assignPrimaryAdmin(
        'clinic-a',
        { email: 'a@example.com', firstName: 'A', lastName: 'B', temporaryPassword: 'password123' },
        'admin-1',
      );

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.clinicMembership.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            clinicId: 'clinic-a',
            roleId: 'role-clinic-admin',
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      expect(clinic.primaryAdmin?.id).toBe('user-1');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ASSIGN_PRIMARY_ADMIN', actorType: 'PLATFORM_USER' }),
      );
    });
  });

  describe('clinic lifecycle transitions (Super Admin registry)', () => {
    it('activateClinic sets status ACTIVE and records an audit event', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.clinic.findUnique.mockResolvedValue({ ...BASE_CLINIC });
      prisma.clinic.update.mockResolvedValue({ ...BASE_CLINIC, status: 'ACTIVE' });

      await service.activateClinic('clinic-a', 'admin-1');

      expect(prisma.clinic.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'clinic-a' }, data: { status: 'ACTIVE' } }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ACTIVATE', actorType: 'PLATFORM_USER' }),
      );
    });

    it('suspendClinic sets status SUSPENDED', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.findUnique.mockResolvedValue({ ...BASE_CLINIC });
      prisma.clinic.update.mockResolvedValue({ ...BASE_CLINIC, status: 'SUSPENDED' });

      await service.suspendClinic('clinic-a', 'admin-1');

      expect(prisma.clinic.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'clinic-a' }, data: { status: 'SUSPENDED' } }),
      );
    });

    it('archiveClinic sets status ARCHIVED', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.findUnique.mockResolvedValue({ ...BASE_CLINIC });
      prisma.clinic.update.mockResolvedValue({ ...BASE_CLINIC, status: 'ARCHIVED' });

      await service.archiveClinic('clinic-a', 'admin-1');

      expect(prisma.clinic.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'clinic-a' }, data: { status: 'ARCHIVED' } }),
      );
    });

    it('404s transitioning a clinic that does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.findUnique.mockResolvedValue(null);
      await expect(service.suspendClinic('missing', 'admin-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listClinics (Super Admin registry)', () => {
    it('paginates and filters by status/search/onboardingStatus', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.count.mockResolvedValue(1);
      prisma.clinic.findMany.mockResolvedValue([{ ...BASE_CLINIC }]);

      const result = await service.listClinics({
        page: 2,
        pageSize: 10,
        status: 'ACTIVE',
        search: 'river',
        onboardingStatus: 'NOT_STARTED',
      });

      expect(result.meta).toEqual({ total: 1, page: 2, pageSize: 10 });
      expect(result.data[0].id).toBe('clinic-a');
      expect(prisma.clinic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.clinic.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ACTIVE', onboardingStatus: 'NOT_STARTED' }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });
  });

  describe('clinic registration documents (SA-03.1)', () => {
    it('rejects an unsupported mime type', async () => {
      const { service, prisma } = makeService();
      prisma.clinic.findUnique.mockResolvedValue({ ...BASE_CLINIC });

      await expect(
        service.uploadClinicDocument(
          'clinic-a',
          'admin-1',
          { category: 'REGISTRATION_CERTIFICATE' },
          {
            originalname: 'cert.exe',
            mimetype: 'application/x-msdownload',
            size: 10,
            buffer: Buffer.from('x'),
          } as Express.Multer.File,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('saves the file via the storage provider and creates a ClinicDocument row', async () => {
      const { service, prisma, storage } = makeService();
      prisma.clinic.findUnique.mockResolvedValue({ ...BASE_CLINIC });
      prisma.clinicDocument.create.mockResolvedValue({
        id: 'doc-1',
        clinicId: 'clinic-a',
        uploadedByUserId: 'admin-1',
        category: 'REGISTRATION_CERTIFICATE',
        fileName: 'cert.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const doc = await service.uploadClinicDocument(
        'clinic-a',
        'admin-1',
        { category: 'REGISTRATION_CERTIFICATE' },
        {
          originalname: 'cert.pdf',
          mimetype: 'application/pdf',
          size: 10,
          buffer: Buffer.from('x'),
        } as Express.Multer.File,
      );

      // eslint-disable-next-line @typescript-eslint/unbound-method -- test mock, never invoked unbound
      expect(storage.save).toHaveBeenCalled();
      expect(doc.id).toBe('doc-1');
      expect((doc as unknown as { storageKey?: string }).storageKey).toBeUndefined();
    });

    it('deleteClinicDocument soft-deletes and audits', async () => {
      const { service, prisma, auditService } = makeService();
      prisma.clinicDocument.findFirst.mockResolvedValue({ id: 'doc-1', clinicId: 'clinic-a' });

      await service.deleteClinicDocument('clinic-a', 'doc-1', 'admin-1');

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(prisma.clinicDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doc-1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DELETE', entity: 'ClinicDocument' }),
      );
    });

    it('deleteClinicDocument 404s for a document belonging to another clinic', async () => {
      const { service, prisma } = makeService();
      prisma.clinicDocument.findFirst.mockResolvedValue(null);
      await expect(service.deleteClinicDocument('clinic-a', 'doc-1', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
