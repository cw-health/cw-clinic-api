import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ClinicHoliday, ClinicWorkingHours, Prisma } from '@prisma/client';
import type { Readable } from 'node:stream';
import { hashPassword } from '../auth/password.util';
import { AuditService } from '../audit/audit.service';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import {
  buildClinicDocumentStorageKey,
  extensionMatchesMimeType,
  isAllowedMimeType,
} from '../documents/document-storage.util';
import {
  DOCUMENT_STORAGE_PROVIDER,
  type DocumentStorageProvider,
} from '../documents/storage-providers/document-storage-provider.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
  CLINIC_WITH_PRIMARY_ADMIN_INCLUDE,
  computeOnboarding,
  overlayDefined,
  toClinicAdminResponseDto,
  toClinicCreateData,
  toClinicUpdateData,
  type ClinicWithPrimaryAdmin,
} from './clinic-mapping.util';
import type { AdminUpdateClinicDto } from './dto/admin-update-clinic.dto';
import type { ClinicAdminResponseDto } from './dto/clinic-admin-response.dto';
import type { ClinicDocumentResponseDto } from './dto/clinic-document-response.dto';
import type { CreateClinicDocumentDto } from './dto/create-clinic-document.dto';
import type { CreateClinicDto } from './dto/create-clinic.dto';
import type { CreateHolidayDto } from './dto/create-holiday.dto';
import type { CreatePrimaryAdminDto } from './dto/create-primary-admin.dto';
import type { OnboardingAddressDto } from './dto/onboarding-address.dto';
import type { OnboardingBasicInfoDto } from './dto/onboarding-basic-info.dto';
import type { OnboardingLegalInfoDto } from './dto/onboarding-legal-info.dto';
import {
  ONBOARDING_STEP_KEYS,
  type OnboardingStatusResponseDto,
  type OnboardingStepKey,
  type OnboardingStepStatus,
} from './dto/onboarding-status-response.dto';
import type { QueryClinicsDto } from './dto/query-clinics.dto';
import type { SetWorkingHoursDto } from './dto/set-working-hours.dto';
import type { UpdateClinicDto } from './dto/update-clinic.dto';

/** Wizard step labels (Phase 1A) — display copy for `GET /clinics/me/onboarding`'s `steps[]`. */
const ONBOARDING_STEP_LABELS: Record<OnboardingStepKey, string> = {
  BASIC_INFO: 'Hospital information',
  LEGAL_INFO: 'Legal information',
  ADDRESS: 'Address',
  WORKING_HOURS: 'Working hours',
  PRIMARY_ADMIN: 'Primary administrator',
};

/** Clinic-registry lifecycle statuses a Super Admin can transition a clinic through (SA-03). */
type ClinicLifecycleStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

@Injectable()
export class ClinicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @Inject(DOCUMENT_STORAGE_PROVIDER) private readonly storage: DocumentStorageProvider,
  ) {}

  async getOwnClinic(clinicId: string): Promise<ClinicAdminResponseDto> {
    return toClinicAdminResponseDto(await this.getClinicRowOrThrow(clinicId));
  }

  /**
   * ClinicAdmin's self-service profile PATCH (`PATCH /clinics/me`) — also
   * the shared write path behind each onboarding-wizard step endpoint
   * below (`updateOnboardingBasicInfo`/`LegalInfo`/`Address`), since a step
   * DTO is always a whitelisted subset of `UpdateClinicDto`'s fields.
   */
  async updateOwnClinic(
    clinicId: string,
    dto: UpdateClinicDto,
    actorUserId: string,
  ): Promise<ClinicAdminResponseDto> {
    return this.writeOwnClinicProfile(clinicId, actorUserId, dto);
  }

  private async writeOwnClinicProfile(
    clinicId: string,
    actorUserId: string,
    dto: Partial<UpdateClinicDto>,
  ): Promise<ClinicAdminResponseDto> {
    const existing = await this.getClinicRowOrThrow(clinicId);

    // Scoped to exactly the fields computeOnboarding reads — see
    // overlayDefined's own comment on why a full-object spread is wrong
    // here (a step DTO's untouched fields are still own keys with value
    // `undefined`, which must not blank out `existing`'s real value).
    const merged = overlayDefined(
      {
        contactEmail: existing.contactEmail,
        addressLine1: existing.addressLine1,
        city: existing.city,
        country: existing.country,
        legalEntityType: existing.legalEntityType,
        registrationApplicable: existing.registrationApplicable,
        registrationNumber: existing.registrationNumber,
      },
      {
        contactEmail: dto.contactEmail,
        addressLine1: dto.addressLine1,
        city: dto.city,
        country: dto.country,
        legalEntityType: dto.legalEntityType,
        registrationApplicable: dto.registrationApplicable,
        registrationNumber: dto.registrationNumber,
      },
    );
    const onboarding = computeOnboarding(merged, !!existing.primaryAdminUser, existing);

    const clinic = await this.prisma.clinic.update({
      where: { id: clinicId },
      data: {
        ...toClinicUpdateData(dto),
        onboardingStatus: onboarding.onboardingStatus,
        onboardingCompletedAt: onboarding.onboardingCompletedAt,
      },
      include: CLINIC_WITH_PRIMARY_ADMIN_INCLUDE,
    });

    await this.recordOnboardingStartedIfNeeded(
      clinicId,
      actorUserId,
      existing.onboardingStatus,
      onboarding.onboardingStatus,
    );
    await this.auditService.record({
      clinicId,
      actorUserId,
      actorType: 'TENANT_USER',
      entity: 'Clinic',
      entityId: clinicId,
      action: 'UPDATE',
      changedFields: Object.keys(dto).join(','),
    });

    return toClinicAdminResponseDto(clinic);
  }

  /** Fires once, the first time a clinic's own onboarding actually progresses past NOT_STARTED — never re-fired on later edits. */
  private async recordOnboardingStartedIfNeeded(
    clinicId: string,
    actorUserId: string,
    previousStatus: string,
    newStatus: string,
  ): Promise<void> {
    if (previousStatus !== 'NOT_STARTED' || newStatus === 'NOT_STARTED') return;
    await this.auditService.record({
      clinicId,
      actorUserId,
      actorType: 'TENANT_USER',
      entity: 'Clinic',
      entityId: clinicId,
      action: 'ONBOARDING_STARTED',
    });
  }

  // ---- Tenant self-service onboarding wizard (Phase 1A) ----

  async getOnboardingStatus(clinicId: string): Promise<OnboardingStatusResponseDto> {
    const existing = await this.getClinicRowOrThrow(clinicId);
    const clinic = toClinicAdminResponseDto(existing);
    const hasWorkingHours =
      (await this.prisma.clinicWorkingHours.count({ where: { clinicId } })) > 0;

    const completion: Record<OnboardingStepKey, boolean> = {
      BASIC_INFO: !!existing.contactEmail,
      LEGAL_INFO:
        !!existing.legalEntityType &&
        (existing.registrationApplicable === false || !!existing.registrationNumber),
      ADDRESS: !!(existing.addressLine1 && existing.city && existing.country),
      WORKING_HOURS: hasWorkingHours,
      PRIMARY_ADMIN: !!existing.primaryAdminUserId,
    };

    const steps: OnboardingStepStatus[] = ONBOARDING_STEP_KEYS.map((key) => ({
      key,
      label: ONBOARDING_STEP_LABELS[key],
      completed: completion[key],
    }));

    return {
      onboardingStatus: clinic.onboardingStatus,
      onboardingCompletedAt: clinic.onboardingCompletedAt,
      missingRequiredFields: clinic.missingRequiredFields,
      steps,
      currentStep: steps.find((s) => !s.completed)?.key ?? 'REVIEW',
      clinic,
    };
  }

  async updateOnboardingBasicInfo(
    clinicId: string,
    dto: OnboardingBasicInfoDto,
    actorUserId: string,
  ): Promise<ClinicAdminResponseDto> {
    return this.writeOwnClinicProfile(clinicId, actorUserId, dto);
  }

  async updateOnboardingLegalInfo(
    clinicId: string,
    dto: OnboardingLegalInfoDto,
    actorUserId: string,
  ): Promise<ClinicAdminResponseDto> {
    return this.writeOwnClinicProfile(clinicId, actorUserId, dto);
  }

  async updateOnboardingAddress(
    clinicId: string,
    dto: OnboardingAddressDto,
    actorUserId: string,
  ): Promise<ClinicAdminResponseDto> {
    return this.writeOwnClinicProfile(clinicId, actorUserId, dto);
  }

  /**
   * Onboarding wizard step 5 ("Primary administrator"). Deliberately
   * narrower than Super Admin's `POST /super-admin/clinics/:id/primary-
   * admin` (which creates a brand-new `User`): here the acting user is
   * already an authenticated ClinicAdmin for this clinic (TenantGuard), so
   * self-designation is the only thing this endpoint needs — `actorUserId`
   * comes from the JWT, never from the request body (docs/SECURITY.md §4),
   * so a caller can never designate anyone but themselves. Create-only,
   * same as the Super Admin path: reassigning an existing primary admin is
   * out of scope here.
   */
  async assignSelfAsPrimaryAdmin(
    clinicId: string,
    actorUserId: string,
  ): Promise<ClinicAdminResponseDto> {
    const existing = await this.getClinicRowOrThrow(clinicId);
    if (existing.primaryAdminUserId === actorUserId) {
      return toClinicAdminResponseDto(existing); // idempotent no-op
    }
    if (existing.primaryAdminUserId) {
      throw new ConflictException('This clinic already has a primary administrator');
    }

    const onboarding = computeOnboarding(existing, true, existing);
    const clinic = await this.prisma.clinic.update({
      where: { id: clinicId },
      data: {
        primaryAdminUserId: actorUserId,
        onboardingStatus: onboarding.onboardingStatus,
        onboardingCompletedAt: onboarding.onboardingCompletedAt,
      },
      include: CLINIC_WITH_PRIMARY_ADMIN_INCLUDE,
    });

    await this.recordOnboardingStartedIfNeeded(
      clinicId,
      actorUserId,
      existing.onboardingStatus,
      onboarding.onboardingStatus,
    );
    await this.auditService.record({
      clinicId,
      actorUserId,
      actorType: 'TENANT_USER',
      entity: 'Clinic',
      entityId: clinicId,
      action: 'UPDATE',
      changedFields: 'primaryAdminUserId',
    });

    return toClinicAdminResponseDto(clinic);
  }

  /**
   * Onboarding wizard step 7 ("Complete onboarding") — an explicit,
   * audited action rather than relying only on the automatic
   * recomputation every write already does, so completion is a real event
   * the frontend can call and the audit trail can show, and so a clinic
   * genuinely missing required information gets a clear, itemized 400
   * instead of silently staying IN_PROGRESS.
   */
  async completeOnboarding(clinicId: string, actorUserId: string): Promise<ClinicAdminResponseDto> {
    const existing = await this.getClinicRowOrThrow(clinicId);
    const onboarding = computeOnboarding(existing, !!existing.primaryAdminUser, existing);

    if (onboarding.missingRequiredFields.length > 0) {
      throw new BadRequestException({
        message: 'Onboarding is not yet complete',
        missingRequiredFields: onboarding.missingRequiredFields,
      });
    }

    if (existing.onboardingStatus === 'COMPLETED') {
      return toClinicAdminResponseDto(existing); // idempotent — no duplicate audit event
    }

    const clinic = await this.prisma.clinic.update({
      where: { id: clinicId },
      data: {
        onboardingStatus: 'COMPLETED',
        onboardingCompletedAt: existing.onboardingCompletedAt ?? new Date(),
      },
      include: CLINIC_WITH_PRIMARY_ADMIN_INCLUDE,
    });

    await this.auditService.record({
      clinicId,
      actorUserId,
      actorType: 'TENANT_USER',
      entity: 'Clinic',
      entityId: clinicId,
      action: 'ONBOARDING_COMPLETED',
    });

    return toClinicAdminResponseDto(clinic);
  }

  async getWorkingHours(clinicId: string): Promise<ClinicWorkingHours[]> {
    return this.prisma.clinicWorkingHours.findMany({
      where: { clinicId },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  /** Single day's working hours row, for appointment slot calculation (Phase 5). */
  async getWorkingHoursForDay(
    clinicId: string,
    dayOfWeek: number,
  ): Promise<ClinicWorkingHours | null> {
    return this.prisma.clinicWorkingHours.findUnique({
      where: { clinicId_dayOfWeek: { clinicId, dayOfWeek } },
    });
  }

  /** Whether `date` (clinic-local calendar date) is a closure day, for appointment slot calculation (Phase 5). */
  async isHoliday(clinicId: string, date: Date): Promise<boolean> {
    const holiday = await this.prisma.clinicHoliday.findUnique({
      where: { clinicId_date: { clinicId, date } },
    });
    return holiday !== null;
  }

  /** Full-week replace, transactional (docs/DATABASE.md §1: clinicId-scoped, mirrors the RolePermission delete+recreate pattern for SQL Server). */
  async setWorkingHours(
    clinicId: string,
    dto: SetWorkingHoursDto,
    actorUserId: string,
  ): Promise<ClinicWorkingHours[]> {
    this.validateWorkingHours(dto);

    await this.prisma.$transaction([
      this.prisma.clinicWorkingHours.deleteMany({ where: { clinicId } }),
      this.prisma.clinicWorkingHours.createMany({
        data: dto.days.map((day) => ({
          clinicId,
          dayOfWeek: day.dayOfWeek,
          isOpen: day.isOpen,
          openTime: day.isOpen ? day.openTime : null,
          closeTime: day.isOpen ? day.closeTime : null,
        })),
      }),
    ]);

    // Field names/day count only — never the actual opening/closing times
    // (docs/SECURITY.md §8's "no full payload" rule applies to settings
    // just as much as PHI, even though hours aren't sensitive: keep one
    // audit-shape convention across ClinicsService).
    await this.auditService.record({
      clinicId,
      actorUserId,
      actorType: 'TENANT_USER',
      entity: 'ClinicWorkingHours',
      entityId: clinicId,
      action: 'UPDATE',
      changedFields: `days:${dto.days.length}`,
    });

    return this.getWorkingHours(clinicId);
  }

  private validateWorkingHours(dto: SetWorkingHoursDto): void {
    const seenDays = new Set<number>();
    for (const day of dto.days) {
      if (seenDays.has(day.dayOfWeek)) {
        throw new ConflictException(`Duplicate dayOfWeek ${day.dayOfWeek} in request`);
      }
      seenDays.add(day.dayOfWeek);
      if (day.isOpen && (!day.openTime || !day.closeTime)) {
        throw new ConflictException(
          `dayOfWeek ${day.dayOfWeek}: openTime/closeTime required when isOpen is true`,
        );
      }
      if (day.isOpen && day.openTime && day.closeTime && day.openTime >= day.closeTime) {
        throw new ConflictException(
          `dayOfWeek ${day.dayOfWeek}: openTime must be before closeTime`,
        );
      }
    }
  }

  async listHolidays(clinicId: string): Promise<ClinicHoliday[]> {
    return this.prisma.clinicHoliday.findMany({ where: { clinicId }, orderBy: { date: 'asc' } });
  }

  async addHoliday(
    clinicId: string,
    dto: CreateHolidayDto,
    actorUserId: string,
  ): Promise<ClinicHoliday> {
    const existing = await this.prisma.clinicHoliday.findUnique({
      where: { clinicId_date: { clinicId, date: new Date(dto.date) } },
    });
    if (existing) throw new ConflictException('A holiday already exists on this date');

    const holiday = await this.prisma.clinicHoliday.create({
      data: { clinicId, date: new Date(dto.date), name: dto.name },
    });

    // The date is a scheduling fact, not PII/PHI — safe to record directly,
    // same reasoning as every other non-sensitive `changedFields` value in
    // this service (e.g. `primaryAdminUserId`).
    await this.auditService.record({
      clinicId,
      actorUserId,
      actorType: 'TENANT_USER',
      entity: 'ClinicHoliday',
      entityId: holiday.id,
      action: 'CREATE',
      changedFields: `date:${dto.date}`,
    });

    return holiday;
  }

  async removeHoliday(clinicId: string, holidayId: string, actorUserId: string): Promise<void> {
    const holiday = await this.prisma.clinicHoliday.findFirst({
      where: { id: holidayId, clinicId },
    });
    if (!holiday) throw new NotFoundException('Holiday not found');
    await this.prisma.clinicHoliday.delete({ where: { id: holiday.id } });

    await this.auditService.record({
      clinicId,
      actorUserId,
      actorType: 'TENANT_USER',
      entity: 'ClinicHoliday',
      entityId: holiday.id,
      action: 'DELETE',
    });
  }

  // ---- Super Admin clinic registry (SA-03, extended SA-03.1 for onboarding) ----

  private async getClinicRowOrThrow(id: string): Promise<ClinicWithPrimaryAdmin> {
    const clinic = await this.prisma.clinic.findUnique({
      where: { id },
      include: CLINIC_WITH_PRIMARY_ADMIN_INCLUDE,
    });
    if (!clinic) throw new NotFoundException('Clinic not found');
    return clinic;
  }

  /** Looks up the seeded `ClinicAdmin` system role template — same guard DoctorsService.create uses for `Doctor`. */
  private async requireClinicAdminRole(): Promise<{ id: string }> {
    const role = await this.prisma.role.findFirst({
      where: { clinicId: null, name: 'ClinicAdmin' },
    });
    if (!role) {
      throw new BadRequestException(
        'ClinicAdmin role template is not seeded — cannot assign a primary administrator',
      );
    }
    return role;
  }

  async createClinic(dto: CreateClinicDto, actorUserId: string): Promise<ClinicAdminResponseDto> {
    const existingSlug = await this.prisma.clinic.findUnique({ where: { slug: dto.slug } });
    if (existingSlug) throw new ConflictException('A clinic with this slug already exists');

    let adminRoleId: string | undefined;
    if (dto.primaryAdmin) {
      const existingUser = await this.prisma.user.findUnique({
        where: { email: dto.primaryAdmin.email },
      });
      if (existingUser) throw new ConflictException('A user with this email already exists');
      adminRoleId = (await this.requireClinicAdminRole()).id;
    }

    const clinic = await this.prisma.$transaction(async (tx) => {
      const created = await tx.clinic.create({ data: toClinicCreateData(dto) });

      let primaryAdminUserId: string | undefined;
      if (dto.primaryAdmin && adminRoleId) {
        const passwordHash = await hashPassword(dto.primaryAdmin.temporaryPassword);
        const user = await tx.user.create({
          data: {
            email: dto.primaryAdmin.email,
            passwordHash,
            firstName: dto.primaryAdmin.firstName,
            lastName: dto.primaryAdmin.lastName,
            status: 'ACTIVE',
          },
        });
        await tx.clinicMembership.create({
          data: { userId: user.id, clinicId: created.id, roleId: adminRoleId, status: 'ACTIVE' },
        });
        primaryAdminUserId = user.id;
      }

      const onboarding = computeOnboarding(created, !!primaryAdminUserId, created);
      return tx.clinic.update({
        where: { id: created.id },
        data: {
          primaryAdminUserId,
          onboardingStatus: onboarding.onboardingStatus,
          onboardingCompletedAt: onboarding.onboardingCompletedAt,
        },
        include: CLINIC_WITH_PRIMARY_ADMIN_INCLUDE,
      });
    });

    await this.auditService.record({
      clinicId: clinic.id,
      actorUserId,
      actorType: 'PLATFORM_USER',
      entity: 'Clinic',
      entityId: clinic.id,
      action: 'CREATE',
    });

    return toClinicAdminResponseDto(clinic);
  }

  async listClinics(query: QueryClinicsDto): Promise<PaginatedResult<ClinicAdminResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.ClinicWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.onboardingStatus ? { onboardingStatus: query.onboardingStatus } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search } },
              { slug: { contains: query.search } },
              { contactEmail: { contains: query.search } },
            ],
          }
        : {}),
    };

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';
    const orderBy: Prisma.ClinicOrderByWithRelationInput =
      sortBy === 'name' ? { name: sortOrder } : { createdAt: sortOrder };

    const [total, clinics] = await this.prisma.$transaction([
      this.prisma.clinic.count({ where }),
      this.prisma.clinic.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: CLINIC_WITH_PRIMARY_ADMIN_INCLUDE,
      }),
    ]);

    return { data: clinics.map(toClinicAdminResponseDto), meta: { total, page, pageSize } };
  }

  async getClinicById(id: string): Promise<ClinicAdminResponseDto> {
    return toClinicAdminResponseDto(await this.getClinicRowOrThrow(id));
  }

  async updateClinicAdmin(
    id: string,
    dto: AdminUpdateClinicDto,
    actorUserId: string,
  ): Promise<ClinicAdminResponseDto> {
    const existing = await this.getClinicRowOrThrow(id);

    if (dto.slug) {
      const conflict = await this.prisma.clinic.findUnique({ where: { slug: dto.slug } });
      if (conflict && conflict.id !== id) {
        throw new ConflictException('A clinic with this slug already exists');
      }
    }

    // Scoped to exactly the fields computeOnboarding reads — merging the
    // full existing/dto objects would hit a type mismatch (dto's date
    // fields are strings, existing's are Date) for no benefit, since
    // nothing else here is read by the checklist.
    const merged = overlayDefined(
      {
        contactEmail: existing.contactEmail,
        addressLine1: existing.addressLine1,
        city: existing.city,
        country: existing.country,
        legalEntityType: existing.legalEntityType,
        registrationApplicable: existing.registrationApplicable,
        registrationNumber: existing.registrationNumber,
      },
      {
        contactEmail: dto.contactEmail,
        addressLine1: dto.addressLine1,
        city: dto.city,
        country: dto.country,
        legalEntityType: dto.legalEntityType,
        registrationApplicable: dto.registrationApplicable,
        registrationNumber: dto.registrationNumber,
      },
    );
    const onboarding = computeOnboarding(merged, !!existing.primaryAdminUser, existing);

    const clinic = await this.prisma.clinic.update({
      where: { id },
      data: {
        ...toClinicUpdateData(dto),
        onboardingStatus: onboarding.onboardingStatus,
        onboardingCompletedAt: onboarding.onboardingCompletedAt,
      },
      include: CLINIC_WITH_PRIMARY_ADMIN_INCLUDE,
    });

    await this.auditService.record({
      clinicId: id,
      actorUserId,
      actorType: 'PLATFORM_USER',
      entity: 'Clinic',
      entityId: id,
      action: 'UPDATE',
      changedFields: Object.keys(dto).join(','),
    });

    return toClinicAdminResponseDto(clinic);
  }

  /** Assigns a primary administrator to a clinic that doesn't have one yet (SA-03.1) — the deferred half of createClinic's optional `primaryAdmin`. */
  async assignPrimaryAdmin(
    id: string,
    dto: CreatePrimaryAdminDto,
    actorUserId: string,
  ): Promise<ClinicAdminResponseDto> {
    const existing = await this.getClinicRowOrThrow(id);
    if (existing.primaryAdminUserId) {
      throw new ConflictException('This clinic already has a primary administrator');
    }

    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingUser) throw new ConflictException('A user with this email already exists');
    const adminRole = await this.requireClinicAdminRole();

    const clinic = await this.prisma.$transaction(async (tx) => {
      const passwordHash = await hashPassword(dto.temporaryPassword);
      const user = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          status: 'ACTIVE',
        },
      });
      await tx.clinicMembership.create({
        data: { userId: user.id, clinicId: id, roleId: adminRole.id, status: 'ACTIVE' },
      });

      const onboarding = computeOnboarding(existing, true, existing);
      return tx.clinic.update({
        where: { id },
        data: {
          primaryAdminUserId: user.id,
          onboardingStatus: onboarding.onboardingStatus,
          onboardingCompletedAt: onboarding.onboardingCompletedAt,
        },
        include: CLINIC_WITH_PRIMARY_ADMIN_INCLUDE,
      });
    });

    await this.auditService.record({
      clinicId: id,
      actorUserId,
      actorType: 'PLATFORM_USER',
      entity: 'Clinic',
      entityId: id,
      action: 'ASSIGN_PRIMARY_ADMIN',
    });

    return toClinicAdminResponseDto(clinic);
  }

  private async setClinicStatus(
    id: string,
    status: ClinicLifecycleStatus,
    action: string,
    actorUserId: string,
  ): Promise<ClinicAdminResponseDto> {
    await this.getClinicRowOrThrow(id);
    const clinic = await this.prisma.clinic.update({
      where: { id },
      data: { status },
      include: CLINIC_WITH_PRIMARY_ADMIN_INCLUDE,
    });

    await this.auditService.record({
      clinicId: id,
      actorUserId,
      actorType: 'PLATFORM_USER',
      entity: 'Clinic',
      entityId: id,
      action,
    });

    return toClinicAdminResponseDto(clinic);
  }

  async activateClinic(id: string, actorUserId: string): Promise<ClinicAdminResponseDto> {
    return this.setClinicStatus(id, 'ACTIVE', 'ACTIVATE', actorUserId);
  }

  async suspendClinic(id: string, actorUserId: string): Promise<ClinicAdminResponseDto> {
    return this.setClinicStatus(id, 'SUSPENDED', 'SUSPEND', actorUserId);
  }

  async archiveClinic(id: string, actorUserId: string): Promise<ClinicAdminResponseDto> {
    return this.setClinicStatus(id, 'ARCHIVED', 'ARCHIVE', actorUserId);
  }

  // ---- Clinic registration documents (SA-03.1) — reuses DocumentStorageProvider, a separate model from patient-scoped Document ----

  async uploadClinicDocument(
    clinicId: string,
    uploadedByUserId: string,
    dto: CreateClinicDocumentDto,
    file: Express.Multer.File,
  ): Promise<ClinicDocumentResponseDto> {
    await this.getClinicRowOrThrow(clinicId);

    if (!isAllowedMimeType(file.mimetype)) {
      throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);
    }
    if (!extensionMatchesMimeType(file.originalname, file.mimetype)) {
      throw new BadRequestException("File extension doesn't match its declared content type");
    }

    const storageKey = buildClinicDocumentStorageKey(clinicId, file.originalname);
    await this.storage.save(storageKey, file.buffer);

    const document = await this.prisma.clinicDocument.create({
      data: {
        clinicId,
        uploadedByUserId,
        category: dto.category,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey,
        notes: dto.notes,
      },
    });

    await this.auditService.record({
      clinicId,
      actorUserId: uploadedByUserId,
      actorType: 'PLATFORM_USER',
      entity: 'ClinicDocument',
      entityId: document.id,
      action: 'CREATE',
      changedFields: `category=${document.category}`,
    });

    return this.toClinicDocumentResponseDto(document);
  }

  async listClinicDocuments(clinicId: string): Promise<ClinicDocumentResponseDto[]> {
    await this.getClinicRowOrThrow(clinicId);
    const documents = await this.prisma.clinicDocument.findMany({
      where: { clinicId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return documents.map((d) => this.toClinicDocumentResponseDto(d));
  }

  private async getClinicDocumentOrThrow(clinicId: string, documentId: string) {
    const document = await this.prisma.clinicDocument.findFirst({
      where: { id: documentId, clinicId, deletedAt: null },
    });
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }

  async getClinicDocumentContent(
    clinicId: string,
    documentId: string,
  ): Promise<{ stream: Readable; fileName: string; mimeType: string }> {
    const document = await this.getClinicDocumentOrThrow(clinicId, documentId);
    const stream = await this.storage.read(document.storageKey);
    return { stream, fileName: document.fileName, mimeType: document.mimeType };
  }

  async deleteClinicDocument(
    clinicId: string,
    documentId: string,
    actorUserId: string,
  ): Promise<void> {
    const document = await this.getClinicDocumentOrThrow(clinicId, documentId);
    await this.prisma.clinicDocument.update({
      where: { id: document.id },
      data: { deletedAt: new Date() },
    });

    await this.auditService.record({
      clinicId,
      actorUserId,
      actorType: 'PLATFORM_USER',
      entity: 'ClinicDocument',
      entityId: document.id,
      action: 'DELETE',
    });
  }

  private toClinicDocumentResponseDto(document: {
    id: string;
    clinicId: string;
    uploadedByUserId: string;
    category: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): ClinicDocumentResponseDto {
    return {
      id: document.id,
      clinicId: document.clinicId,
      uploadedByUserId: document.uploadedByUserId,
      category: document.category,
      fileName: document.fileName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      notes: document.notes,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }
}
