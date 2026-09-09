import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Patient, Prisma } from '@prisma/client';
import { hashPassword } from '../auth/password.util';
import { AuditActions } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import type { AuditRequestContext } from '../common/decorators/audit-context.decorator';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import { buildMultiFieldSearchWhere } from '../common/multi-field-search.util';
import { PrismaService } from '../prisma/prisma.service';
import { assertScopedWrite } from '../common/scoped-write.util';
import type { CheckPatientDuplicatesDto } from './dto/check-duplicates.dto';
import type { CreatePatientDto } from './dto/create-patient.dto';
import type {
  DuplicateMatchReason,
  DuplicatePatientCandidate,
  PatientResponseDto,
} from './dto/patient-response.dto';
import type { QueryPatientsDto } from './dto/query-patients.dto';
import type { UpdateOwnPatientDto, UpdatePatientDto } from './dto/update-patient.dto';

/** Fields whose change on update() re-triggers a duplicate check (docs: registration data, not clinical/address edits). */
const DUPLICATE_SENSITIVE_FIELDS = [
  'phone',
  'email',
  'firstName',
  'lastName',
  'dateOfBirth',
] as const;

const MAX_MRN_ATTEMPTS = 5;

@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    clinicId: string,
    dto: CreatePatientDto,
    actorUserId: string,
    reqCtx?: AuditRequestContext,
  ): Promise<PatientResponseDto> {
    if (dto.createPortalAccount) {
      if (!dto.email) throw new ConflictException('email is required to create a portal account');
      const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (existingUser) throw new ConflictException('A user with this email already exists');
    }

    const duplicates = await this.checkDuplicates(clinicId, {
      phone: dto.phone,
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      dateOfBirth: dto.dateOfBirth,
    });
    if (duplicates.length > 0 && dto.confirmDuplicate !== true) {
      // The candidate list itself is deliberately not attached to this
      // exception: AllExceptionsFilter's response envelope (docs/API.md §2)
      // only ever forwards statusCode/message/error, so any extra field
      // here would be silently dropped over the wire. The frontend already
      // has the full candidate list from its own POST /patients/
      // check-duplicates pre-flight call before it ever reaches submit —
      // this 409 is a server-side backstop, not the data source.
      throw new ConflictException(
        'Potential duplicate patient(s) found for this clinic — review them via ' +
          'POST /patients/check-duplicates, then resubmit with confirmDuplicate: true',
      );
    }

    const {
      createPortalAccount,
      temporaryPassword,
      confirmDuplicate: _confirmDuplicate,
      dateOfBirth,
      ...patientFields
    } = dto;

    let userId: string | undefined;
    if (createPortalAccount) {
      const patientRole = await this.prisma.role.findFirst({
        where: { clinicId: null, name: 'Patient' },
      });
      if (!patientRole) {
        throw new ConflictException(
          'Patient role template is not seeded — cannot create a portal account',
        );
      }
      const passwordHash = await hashPassword(temporaryPassword!);
      const user = await this.prisma.user.create({
        data: {
          email: dto.email!,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          status: 'ACTIVE',
        },
      });
      await this.prisma.clinicMembership.create({
        data: { userId: user.id, clinicId, roleId: patientRole.id, status: 'ACTIVE' },
      });
      userId = user.id;
    }

    const patient = await this.createWithMrnRetry(clinicId, {
      ...patientFields,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      userId,
    });

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Patient',
      entityId: patient.id,
      action: AuditActions.PATIENT_CREATED,
      // Field names only — never values (docs/SECURITY.md §8).
      changedFields: Object.keys(patientFields).join(','),
      ...reqCtx,
    });

    if (duplicates.length > 0) {
      await this.auditService.record({
        clinicId,
        actorUserId,
        entity: 'Patient',
        entityId: patient.id,
        action: AuditActions.PATIENT_DUPLICATE_OVERRIDDEN,
        // Which existing records this was flagged against — ids only, no PHI.
        changedFields: duplicates.map((d) => d.patient.id).join(','),
        ...reqCtx,
      });
    }

    return toPatientResponseDto(patient);
  }

  async findAll(
    clinicId: string,
    query: QueryPatientsDto,
  ): Promise<PaginatedResult<PatientResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.PatientWhereInput = {
      clinicId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.gender ? { gender: query.gender } : {}),
      ...buildMultiFieldSearchWhere<Prisma.PatientWhereInput>(query.search, (term) => [
        { firstName: { contains: term } },
        { lastName: { contains: term } },
        { phone: { contains: term } },
        { email: { contains: term } },
        { mrn: { contains: term } },
      ]),
    };

    const sortOrder = query.sortOrder ?? 'asc';
    const sortBy = query.sortBy ?? 'name';
    const orderBy: Prisma.PatientOrderByWithRelationInput =
      sortBy === 'name'
        ? { lastName: sortOrder }
        : sortBy === 'mrn'
          ? { mrn: sortOrder }
          : { createdAt: sortOrder };

    const [total, patients] = await this.prisma.$transaction([
      this.prisma.patient.count({ where }),
      this.prisma.patient.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { data: patients.map(toPatientResponseDto), meta: { total, page, pageSize } };
  }

  /** Active patient count for one clinic (SA-09 usage-vs-limit check). */
  async countActive(clinicId: string): Promise<number> {
    return this.prisma.patient.count({ where: { clinicId, status: 'ACTIVE', deletedAt: null } });
  }

  /**
   * Active patient counts for several clinics in one aggregate query (SA-09
   * usage overview) — avoids an N+1 `count()` per clinic. Clinics with zero
   * active patients are simply absent from the result map.
   */
  async countActiveGroupedByClinic(clinicIds: string[]): Promise<Map<string, number>> {
    if (clinicIds.length === 0) return new Map();
    const rows = await this.prisma.patient.groupBy({
      by: ['clinicId'],
      where: { clinicId: { in: clinicIds }, status: 'ACTIVE', deletedAt: null },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.clinicId, row._count._all]));
  }

  async findById(clinicId: string, id: string): Promise<PatientResponseDto> {
    const patient = await this.findActivePatientOrThrow(clinicId, id);
    return toPatientResponseDto(patient);
  }

  /**
   * Single-record PHI access surface — call only from the route that
   * actually shows one patient's record to a person (`GET /patients/:id`),
   * never from an internal cross-service lookup (e.g. resolving a display
   * name for an appointment/consultation), which would over-count
   * PATIENT_VIEWED for every unrelated read of another resource.
   */
  async findByIdAudited(
    clinicId: string,
    id: string,
    actorUserId: string,
    reqCtx?: AuditRequestContext,
  ): Promise<PatientResponseDto> {
    const patient = await this.findById(clinicId, id);
    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Patient',
      entityId: id,
      action: AuditActions.PATIENT_VIEWED,
      ...reqCtx,
    });
    return patient;
  }

  async findOwn(clinicId: string, userId: string): Promise<PatientResponseDto> {
    const patient = await this.prisma.patient.findFirst({
      where: { userId, clinicId, deletedAt: null },
    });
    if (!patient) throw new NotFoundException('Patient profile not found');
    return toPatientResponseDto(patient);
  }

  async update(
    clinicId: string,
    id: string,
    dto: UpdatePatientDto,
    actorUserId: string,
    reqCtx?: AuditRequestContext,
  ): Promise<PatientResponseDto> {
    const existing = await this.findActivePatientOrThrow(clinicId, id);

    const touchesDuplicateSensitiveField = DUPLICATE_SENSITIVE_FIELDS.some(
      (field) => dto[field] !== undefined,
    );
    let duplicates: DuplicatePatientCandidate[] = [];
    if (touchesDuplicateSensitiveField) {
      duplicates = await this.checkDuplicates(clinicId, {
        phone: dto.phone ?? existing.phone ?? undefined,
        email: dto.email ?? existing.email ?? undefined,
        firstName: dto.firstName ?? existing.firstName,
        lastName: dto.lastName ?? existing.lastName,
        dateOfBirth:
          (dto.dateOfBirth ?? existing.dateOfBirth?.toISOString().slice(0, 10)) || undefined,
        excludePatientId: id,
      });
      if (duplicates.length > 0 && dto.confirmDuplicate !== true) {
        // Same reasoning as create()'s own 409 above — no attached payload.
        throw new ConflictException(
          'This update would match potential duplicate patient(s) for this clinic — review them ' +
            'via POST /patients/check-duplicates, then resubmit with confirmDuplicate: true',
        );
      }
    }

    const { dateOfBirth, confirmDuplicate: _confirmDuplicate, ...rest } = dto;
    // Scoped at the query level, not only by the findActivePatientOrThrow
    // check above — see scoped-write.util.ts.
    const result = await this.prisma.patient.updateMany({
      where: { id, clinicId },
      data: { ...rest, dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined },
    });
    assertScopedWrite(result, 'Patient not found');
    const patient = await this.findActivePatientOrThrow(clinicId, id);

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Patient',
      entityId: id,
      action: AuditActions.PATIENT_UPDATED,
      changedFields: Object.keys(rest).join(','),
      ...reqCtx,
    });

    if (duplicates.length > 0) {
      await this.auditService.record({
        clinicId,
        actorUserId,
        entity: 'Patient',
        entityId: id,
        action: AuditActions.PATIENT_DUPLICATE_OVERRIDDEN,
        changedFields: duplicates.map((d) => d.patient.id).join(','),
        ...reqCtx,
      });
    }

    return toPatientResponseDto(patient);
  }

  async updateOwn(
    clinicId: string,
    userId: string,
    dto: UpdateOwnPatientDto,
  ): Promise<PatientResponseDto> {
    const existing = await this.prisma.patient.findFirst({
      where: { userId, clinicId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Patient profile not found');

    const result = await this.prisma.patient.updateMany({
      where: { id: existing.id, clinicId },
      data: dto,
    });
    assertScopedWrite(result, 'Patient profile not found');
    const patient = await this.findActivePatientOrThrow(clinicId, existing.id);
    return toPatientResponseDto(patient);
  }

  /**
   * Potential-duplicate lookup (docs: phone / email / dateOfBirth+name /
   * mrn "at minimum"). Never merges or blocks anything itself — it only
   * reports candidates; `create()`/`update()` are what actually gate on the
   * result via `confirmDuplicate`. An under-specified `params` (nothing
   * usable to match on) returns no matches rather than throwing, since this
   * is also called live while a registration form is still being filled in.
   */
  async checkDuplicates(
    clinicId: string,
    params: CheckPatientDuplicatesDto,
  ): Promise<DuplicatePatientCandidate[]> {
    const or: Prisma.PatientWhereInput[] = [];
    if (params.phone) or.push({ phone: params.phone });
    if (params.email) or.push({ email: params.email });
    if (params.mrn) or.push({ mrn: params.mrn });
    if (params.firstName && params.lastName && params.dateOfBirth) {
      or.push({
        firstName: params.firstName,
        lastName: params.lastName,
        dateOfBirth: new Date(params.dateOfBirth),
      });
    }
    if (or.length === 0) return [];

    const patients = await this.prisma.patient.findMany({
      where: {
        clinicId,
        deletedAt: null,
        ...(params.excludePatientId ? { id: { not: params.excludePatientId } } : {}),
        OR: or,
      },
    });

    return patients.map((patient) => ({
      patient: toPatientResponseDto(patient),
      matchedOn: matchReasonsFor(patient, params),
    }));
  }

  /** Toggle ACTIVE/INACTIVE — not available once ARCHIVED (restore() first). */
  async activate(
    clinicId: string,
    id: string,
    actorUserId: string,
    reqCtx?: AuditRequestContext,
  ): Promise<PatientResponseDto> {
    await this.assertNotArchived(clinicId, id);
    return this.setStatus(
      clinicId,
      id,
      'ACTIVE',
      AuditActions.PATIENT_ACTIVATED,
      actorUserId,
      reqCtx,
    );
  }

  /** Toggle ACTIVE/INACTIVE — not available once ARCHIVED (restore() first). */
  async deactivate(
    clinicId: string,
    id: string,
    actorUserId: string,
    reqCtx?: AuditRequestContext,
  ): Promise<PatientResponseDto> {
    await this.assertNotArchived(clinicId, id);
    return this.setStatus(
      clinicId,
      id,
      'INACTIVE',
      AuditActions.PATIENT_DEACTIVATED,
      actorUserId,
      reqCtx,
    );
  }

  private async assertNotArchived(clinicId: string, id: string): Promise<void> {
    const existing = await this.findActivePatientOrThrow(clinicId, id);
    if (existing.status === 'ARCHIVED') {
      throw new ConflictException('An archived patient must be restored before changing status');
    }
  }

  /**
   * Archive is the only removal-like action on a Patient (never a hard/
   * soft delete). Reversible via restore() — unlike Branch/Department's
   * one-way archive, a patient can legitimately return or be mis-archived
   * by mistake, and PHI history must stay recoverable.
   */
  async archive(
    clinicId: string,
    id: string,
    actorUserId: string,
    reqCtx?: AuditRequestContext,
  ): Promise<PatientResponseDto> {
    const existing = await this.findActivePatientOrThrow(clinicId, id);
    if (existing.status === 'ARCHIVED') {
      throw new ConflictException('Patient is already archived');
    }
    return this.setStatus(
      clinicId,
      id,
      'ARCHIVED',
      AuditActions.PATIENT_ARCHIVED,
      actorUserId,
      reqCtx,
    );
  }

  async restore(
    clinicId: string,
    id: string,
    actorUserId: string,
    reqCtx?: AuditRequestContext,
  ): Promise<PatientResponseDto> {
    const existing = await this.findActivePatientOrThrow(clinicId, id);
    if (existing.status !== 'ARCHIVED') {
      throw new ConflictException('Patient is not archived');
    }
    return this.setStatus(
      clinicId,
      id,
      'ACTIVE',
      AuditActions.PATIENT_RESTORED,
      actorUserId,
      reqCtx,
    );
  }

  /**
   * Raw status write shared by activate/deactivate/archive/restore — each
   * of those does its own pre-check (archived-is-terminal-for-activate/
   * deactivate, already-archived, not-archived) *before* calling this, so
   * it never re-derives a rule from the target status here.
   */
  private async setStatus(
    clinicId: string,
    id: string,
    status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED',
    action: string,
    actorUserId: string,
    reqCtx?: AuditRequestContext,
  ): Promise<PatientResponseDto> {
    const result = await this.prisma.patient.updateMany({
      where: { id, clinicId },
      data: { status },
    });
    assertScopedWrite(result, 'Patient not found');

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Patient',
      entityId: id,
      action,
      ...reqCtx,
    });

    const patient = await this.findActivePatientOrThrow(clinicId, id);
    return toPatientResponseDto(patient);
  }

  private async findActivePatientOrThrow(clinicId: string, id: string): Promise<Patient> {
    const patient = await this.prisma.patient.findFirst({
      where: { id, clinicId, deletedAt: null },
    });
    if (!patient) throw new NotFoundException('Patient not found');
    return patient;
  }

  /**
   * Sequential per-clinic MRN (docs/DATABASE.md §1: unique per clinic, not
   * globally). Counts existing rows for this clinic (including
   * soft-deleted, so an MRN is never reused). Two concurrent registrations
   * can still compute the same next number — rather than leave that race
   * unhandled, the actual insert is retried against a freshly-generated MRN
   * whenever it collides on the `[clinicId, mrn]` unique constraint (P2002),
   * up to `MAX_MRN_ATTEMPTS` times.
   */
  private async generateMrn(clinicId: string): Promise<string> {
    const count = await this.prisma.patient.count({ where: { clinicId } });
    return `P-${String(count + 1).padStart(6, '0')}`;
  }

  private async createWithMrnRetry(
    clinicId: string,
    data: Omit<Prisma.PatientUncheckedCreateInput, 'clinicId' | 'mrn'>,
  ): Promise<Patient> {
    for (let attempt = 1; attempt <= MAX_MRN_ATTEMPTS; attempt++) {
      const mrn = await this.generateMrn(clinicId);
      try {
        return await this.prisma.patient.create({ data: { ...data, clinicId, mrn } });
      } catch (error) {
        const isMrnCollision = (error as { code?: string }).code === 'P2002';
        if (!isMrnCollision || attempt === MAX_MRN_ATTEMPTS) throw error;
      }
    }
    // Unreachable — the loop above always returns or throws.
    throw new ConflictException('Could not generate a unique MRN — please retry');
  }
}

function matchReasonsFor(
  patient: Patient,
  params: CheckPatientDuplicatesDto,
): DuplicateMatchReason[] {
  const reasons: DuplicateMatchReason[] = [];
  if (params.phone && patient.phone === params.phone) reasons.push('PHONE');
  if (params.email && patient.email?.toLowerCase() === params.email.toLowerCase()) {
    reasons.push('EMAIL');
  }
  if (params.mrn && patient.mrn.toLowerCase() === params.mrn.toLowerCase()) reasons.push('MRN');
  if (
    params.firstName &&
    params.lastName &&
    params.dateOfBirth &&
    patient.firstName.toLowerCase() === params.firstName.toLowerCase() &&
    patient.lastName.toLowerCase() === params.lastName.toLowerCase() &&
    patient.dateOfBirth?.toISOString().slice(0, 10) === params.dateOfBirth
  ) {
    reasons.push('NAME_DOB');
  }
  return reasons;
}

function toPatientResponseDto(patient: Patient): PatientResponseDto {
  return {
    id: patient.id,
    clinicId: patient.clinicId,
    userId: patient.userId,
    mrn: patient.mrn,
    firstName: patient.firstName,
    lastName: patient.lastName,
    gender: patient.gender,
    dateOfBirth: patient.dateOfBirth,
    phone: patient.phone,
    email: patient.email,
    addressLine1: patient.addressLine1,
    addressLine2: patient.addressLine2,
    city: patient.city,
    state: patient.state,
    postalCode: patient.postalCode,
    country: patient.country,
    emergencyContactName: patient.emergencyContactName,
    emergencyContactPhone: patient.emergencyContactPhone,
    knownAllergies: patient.knownAllergies,
    chronicConditions: patient.chronicConditions,
    status: patient.status,
    createdAt: patient.createdAt,
    updatedAt: patient.updatedAt,
  };
}
