import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Doctor,
  DoctorAvailability,
  DoctorBreak,
  DoctorUnavailability,
  Prisma,
  User,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../auth/password.util';
import { AuditActions } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import type { AuditRequestContext } from '../common/decorators/audit-context.decorator';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import { buildMultiFieldSearchWhere } from '../common/multi-field-search.util';
import { assertScopedWrite } from '../common/scoped-write.util';
import type { CreateDoctorDto } from './dto/create-doctor.dto';
import type { CreateUnavailabilityDto } from './dto/create-unavailability.dto';
import type { DoctorResponseDto } from './dto/doctor-response.dto';
import type { QueryDoctorsDto } from './dto/query-doctors.dto';
import type { SetAvailabilityDto } from './dto/set-availability.dto';
import type { SetBreaksDto } from './dto/set-breaks.dto';
import type { UpdateDoctorDto, UpdateOwnDoctorDto } from './dto/update-doctor.dto';

type DoctorWithRelations = Doctor & {
  user: User;
  specializations: { specialization: { id: string; name: string } }[];
  departments: {
    department: {
      id: string;
      name: string;
      code: string;
      branch: { id: string; name: string; code: string };
    };
  }[];
};

const DOCTOR_INCLUDE = {
  user: true,
  specializations: { include: { specialization: true } },
  departments: {
    include: {
      department: { include: { branch: { select: { id: true, name: true, code: true } } } },
    },
  },
} satisfies Prisma.DoctorInclude;

@Injectable()
export class DoctorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    clinicId: string,
    dto: CreateDoctorDto,
    actorUserId: string,
    reqCtx?: AuditRequestContext,
  ): Promise<DoctorResponseDto> {
    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingUser) throw new ConflictException('A user with this email already exists');

    await this.assertSpecializationsExist(dto.specializationIds);
    await this.assertDepartmentsExist(clinicId, dto.departmentIds);

    const doctorRole = await this.prisma.role.findFirst({
      where: { clinicId: null, name: 'Doctor' },
    });
    if (!doctorRole) {
      throw new BadRequestException('Doctor role template is not seeded — cannot create a doctor');
    }

    const passwordHash = await hashPassword(dto.temporaryPassword);

    const doctor = await this.prisma.$transaction(async (tx) => {
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
        data: { userId: user.id, clinicId, roleId: doctorRole.id, status: 'ACTIVE' },
      });

      return tx.doctor.create({
        data: {
          clinicId,
          userId: user.id,
          phone: dto.phone,
          licenseNumber: dto.licenseNumber,
          qualification: dto.qualification,
          bio: dto.bio,
          consultationFee: dto.consultationFee,
          yearsOfExperience: dto.yearsOfExperience,
          appointmentDurationMinutes: dto.appointmentDurationMinutes,
          specializations: dto.specializationIds
            ? { create: dto.specializationIds.map((specializationId) => ({ specializationId })) }
            : undefined,
          departments: dto.departmentIds
            ? { create: dto.departmentIds.map((departmentId) => ({ departmentId })) }
            : undefined,
        },
        include: DOCTOR_INCLUDE,
      });
    });

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Doctor',
      entityId: doctor.id,
      action: AuditActions.DOCTOR_CREATED,
      ...reqCtx,
    });

    return toDoctorResponseDto(doctor);
  }

  async findAll(
    clinicId: string,
    query: QueryDoctorsDto,
  ): Promise<PaginatedResult<DoctorResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.DoctorWhereInput = {
      clinicId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.specializationId
        ? { specializations: { some: { specializationId: query.specializationId } } }
        : {}),
      ...(query.search
        ? {
            user: buildMultiFieldSearchWhere<Prisma.UserWhereInput>(query.search, (term) => [
              { firstName: { contains: term } },
              { lastName: { contains: term } },
              { email: { contains: term } },
            ]),
          }
        : {}),
    };

    const sortOrder = query.sortOrder ?? 'asc';
    const sortBy = query.sortBy ?? 'name';
    const orderBy: Prisma.DoctorOrderByWithRelationInput =
      sortBy === 'name'
        ? { user: { firstName: sortOrder } }
        : sortBy === 'consultationFee'
          ? { consultationFee: sortOrder }
          : { createdAt: sortOrder };

    const [total, doctors] = await this.prisma.$transaction([
      this.prisma.doctor.count({ where }),
      this.prisma.doctor.findMany({
        where,
        include: DOCTOR_INCLUDE,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data: doctors.map(toDoctorResponseDto),
      meta: { total, page, pageSize },
    };
  }

  /** Active doctor count for one clinic (SA-09 usage-vs-limit check). */
  async countActive(clinicId: string): Promise<number> {
    return this.prisma.doctor.count({ where: { clinicId, status: 'ACTIVE', deletedAt: null } });
  }

  /**
   * Active doctor counts for several clinics in one aggregate query (SA-09
   * usage overview) — avoids an N+1 `count()` per clinic. Clinics with zero
   * active doctors are simply absent from the result map.
   */
  async countActiveGroupedByClinic(clinicIds: string[]): Promise<Map<string, number>> {
    if (clinicIds.length === 0) return new Map();
    const rows = await this.prisma.doctor.groupBy({
      by: ['clinicId'],
      where: { clinicId: { in: clinicIds }, status: 'ACTIVE', deletedAt: null },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.clinicId, row._count._all]));
  }

  async findById(clinicId: string, id: string): Promise<DoctorResponseDto> {
    const doctor = await this.findActiveDoctorOrThrow(clinicId, id);
    return toDoctorResponseDto(doctor);
  }

  /** Single-record view surface — call only from `GET /doctors/:id`, never from an internal cross-service lookup (mirrors PatientsService.findByIdAudited). */
  async findByIdAudited(
    clinicId: string,
    id: string,
    actorUserId: string,
    reqCtx?: AuditRequestContext,
  ): Promise<DoctorResponseDto> {
    const doctor = await this.findById(clinicId, id);
    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Doctor',
      entityId: id,
      action: AuditActions.DOCTOR_VIEWED,
      ...reqCtx,
    });
    return doctor;
  }

  async findOwn(clinicId: string, userId: string): Promise<DoctorResponseDto> {
    const doctor = await this.prisma.doctor.findFirst({
      where: { userId, clinicId, deletedAt: null },
      include: DOCTOR_INCLUDE,
    });
    if (!doctor) throw new NotFoundException('Doctor profile not found');
    return toDoctorResponseDto(doctor);
  }

  async update(
    clinicId: string,
    id: string,
    dto: UpdateDoctorDto,
    actorUserId: string,
    reqCtx?: AuditRequestContext,
  ): Promise<DoctorResponseDto> {
    await this.findActiveDoctorOrThrow(clinicId, id);
    await this.assertSpecializationsExist(dto.specializationIds);
    await this.assertDepartmentsExist(clinicId, dto.departmentIds);

    const { specializationIds, departmentIds, ...rest } = dto;

    const doctor = await this.prisma.$transaction(async (tx) => {
      if (specializationIds) {
        await tx.doctorSpecialization.deleteMany({ where: { doctorId: id } });
        if (specializationIds.length > 0) {
          await tx.doctorSpecialization.createMany({
            data: specializationIds.map((specializationId) => ({ doctorId: id, specializationId })),
          });
        }
      }
      if (departmentIds) {
        await tx.doctorDepartment.deleteMany({ where: { doctorId: id } });
        if (departmentIds.length > 0) {
          await tx.doctorDepartment.createMany({
            data: departmentIds.map((departmentId) => ({ doctorId: id, departmentId })),
          });
        }
      }
      // Scoped at the query level, not only by the findActiveDoctorOrThrow
      // check above — see scoped-write.util.ts.
      const result = await tx.doctor.updateMany({ where: { id, clinicId }, data: rest });
      assertScopedWrite(result, 'Doctor not found');
      return tx.doctor.findFirstOrThrow({ where: { id }, include: DOCTOR_INCLUDE });
    });

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Doctor',
      entityId: id,
      action: AuditActions.DOCTOR_UPDATED,
      changedFields: Object.keys(dto).join(','),
      ...reqCtx,
    });

    return toDoctorResponseDto(doctor);
  }

  async updateOwn(
    clinicId: string,
    userId: string,
    dto: UpdateOwnDoctorDto,
  ): Promise<DoctorResponseDto> {
    const existing = await this.prisma.doctor.findFirst({
      where: { userId, clinicId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Doctor profile not found');

    const result = await this.prisma.doctor.updateMany({
      where: { id: existing.id, clinicId },
      data: dto,
    });
    assertScopedWrite(result, 'Doctor profile not found');
    const doctor = await this.prisma.doctor.findFirstOrThrow({
      where: { id: existing.id },
      include: DOCTOR_INCLUDE,
    });
    return toDoctorResponseDto(doctor);
  }

  /**
   * Activate/deactivate — never a delete. Deactivating a doctor only flips
   * `status`; it never touches `deletedAt`, so the clinical directory row,
   * and every historical Appointment/Consultation/Prescription/Invoice FK
   * pointing at this doctor (all `onDelete: NoAction`, see the doc comment
   * on model Doctor), stay exactly as they were — deactivation is invisible
   * to past clinical records. AppointmentsService separately refuses to
   * book a *new* appointment, or return available slots, for a doctor
   * that isn't ACTIVE (docs plan: "existing appointments remain valid when
   * a doctor is deactivated" means already-booked appointments are left
   * alone, not that the doctor keeps taking new ones).
   */
  async updateStatus(
    clinicId: string,
    id: string,
    status: 'ACTIVE' | 'INACTIVE',
    actorUserId: string,
    reqCtx?: AuditRequestContext,
  ): Promise<DoctorResponseDto> {
    await this.findActiveDoctorOrThrow(clinicId, id);
    const result = await this.prisma.doctor.updateMany({
      where: { id, clinicId },
      data: { status },
    });
    assertScopedWrite(result, 'Doctor not found');
    const doctor = await this.prisma.doctor.findFirstOrThrow({
      where: { id },
      include: DOCTOR_INCLUDE,
    });

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Doctor',
      entityId: id,
      action: status === 'ACTIVE' ? AuditActions.DOCTOR_ACTIVATED : AuditActions.DOCTOR_DEACTIVATED,
      changedFields: `status=${status}`,
      ...reqCtx,
    });

    return toDoctorResponseDto(doctor);
  }

  async getAvailability(clinicId: string, doctorId: string): Promise<DoctorAvailability[]> {
    await this.findActiveDoctorOrThrow(clinicId, doctorId);
    return this.prisma.doctorAvailability.findMany({
      where: { doctorId, clinicId },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  async setAvailability(
    clinicId: string,
    doctorId: string,
    dto: SetAvailabilityDto,
  ): Promise<DoctorAvailability[]> {
    await this.findActiveDoctorOrThrow(clinicId, doctorId);

    const seenDays = new Set<number>();
    for (const day of dto.days) {
      if (seenDays.has(day.dayOfWeek)) {
        throw new ConflictException(`Duplicate dayOfWeek ${day.dayOfWeek} in request`);
      }
      seenDays.add(day.dayOfWeek);
      if (day.startTime >= day.endTime) {
        throw new ConflictException(`dayOfWeek ${day.dayOfWeek}: startTime must be before endTime`);
      }
    }

    await this.prisma.$transaction([
      this.prisma.doctorAvailability.deleteMany({ where: { doctorId } }),
      this.prisma.doctorAvailability.createMany({
        data: dto.days.map((day) => ({
          clinicId,
          doctorId,
          dayOfWeek: day.dayOfWeek,
          isActive: day.isActive,
          startTime: day.startTime,
          endTime: day.endTime,
        })),
      }),
    ]);

    return this.getAvailability(clinicId, doctorId);
  }

  async getBreaks(clinicId: string, doctorId: string): Promise<DoctorBreak[]> {
    await this.findActiveDoctorOrThrow(clinicId, doctorId);
    return this.prisma.doctorBreak.findMany({
      where: { doctorId, clinicId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  /** Full-replace, mirrors setAvailability's validation pattern — reject overlapping/invalid ranges within the same day. */
  async setBreaks(clinicId: string, doctorId: string, dto: SetBreaksDto): Promise<DoctorBreak[]> {
    await this.findActiveDoctorOrThrow(clinicId, doctorId);

    const byDay = new Map<number, { startTime: string; endTime: string }[]>();
    for (const entry of dto.breaks) {
      if (entry.startTime >= entry.endTime) {
        throw new ConflictException(
          `dayOfWeek ${entry.dayOfWeek}: startTime must be before endTime`,
        );
      }
      const existing = byDay.get(entry.dayOfWeek) ?? [];
      for (const other of existing) {
        if (entry.startTime < other.endTime && entry.endTime > other.startTime) {
          throw new ConflictException(`dayOfWeek ${entry.dayOfWeek}: overlapping break ranges`);
        }
      }
      existing.push(entry);
      byDay.set(entry.dayOfWeek, existing);
    }

    await this.prisma.$transaction([
      this.prisma.doctorBreak.deleteMany({ where: { doctorId } }),
      this.prisma.doctorBreak.createMany({
        data: dto.breaks.map((entry) => ({
          clinicId,
          doctorId,
          dayOfWeek: entry.dayOfWeek,
          startTime: entry.startTime,
          endTime: entry.endTime,
        })),
      }),
    ]);

    return this.getBreaks(clinicId, doctorId);
  }

  async listUnavailability(clinicId: string, doctorId: string): Promise<DoctorUnavailability[]> {
    await this.findActiveDoctorOrThrow(clinicId, doctorId);
    return this.prisma.doctorUnavailability.findMany({
      where: { doctorId, clinicId },
      orderBy: { startsAt: 'asc' },
    });
  }

  async addUnavailability(
    clinicId: string,
    doctorId: string,
    dto: CreateUnavailabilityDto,
  ): Promise<DoctorUnavailability> {
    await this.findActiveDoctorOrThrow(clinicId, doctorId);

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (startsAt >= endsAt) {
      throw new ConflictException('startsAt must be before endsAt');
    }

    return this.prisma.doctorUnavailability.create({
      data: { clinicId, doctorId, startsAt, endsAt, reason: dto.reason },
    });
  }

  async removeUnavailability(clinicId: string, doctorId: string, id: string): Promise<void> {
    await this.findActiveDoctorOrThrow(clinicId, doctorId);
    const existing = await this.prisma.doctorUnavailability.findFirst({
      where: { id, doctorId, clinicId },
    });
    if (!existing) throw new NotFoundException('Unavailability entry not found');
    await this.prisma.doctorUnavailability.delete({ where: { id: existing.id } });
  }

  /**
   * Raw schedule lookups for a single day/date, used by
   * AppointmentsService's slot calculation (docs plan §1.5). No ownership
   * throw — the caller (AppointmentsService) has already resolved/validated
   * the doctor id itself; this is a plain data read, not a route handler.
   */
  async getAvailabilityForDay(
    doctorId: string,
    dayOfWeek: number,
  ): Promise<DoctorAvailability | null> {
    return this.prisma.doctorAvailability.findFirst({ where: { doctorId, dayOfWeek } });
  }

  async getBreaksForDay(doctorId: string, dayOfWeek: number): Promise<DoctorBreak[]> {
    return this.prisma.doctorBreak.findMany({ where: { doctorId, dayOfWeek } });
  }

  async getUnavailabilityOverlapping(
    doctorId: string,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<DoctorUnavailability[]> {
    return this.prisma.doctorUnavailability.findMany({
      where: { doctorId, startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } },
    });
  }

  /** Raw doctor row (no DTO mapping, no ownership throw) for cross-module reads like appointment slot calculation. */
  async getDoctorRow(clinicId: string, doctorId: string): Promise<Doctor | null> {
    return this.prisma.doctor.findFirst({ where: { id: doctorId, clinicId, deletedAt: null } });
  }

  private async findActiveDoctorOrThrow(
    clinicId: string,
    id: string,
  ): Promise<DoctorWithRelations> {
    const doctor = await this.prisma.doctor.findFirst({
      where: { id, clinicId, deletedAt: null },
      include: DOCTOR_INCLUDE,
    });
    if (!doctor) throw new NotFoundException('Doctor not found');
    return doctor;
  }

  private async assertSpecializationsExist(ids: string[] | undefined): Promise<void> {
    if (!ids || ids.length === 0) return;
    const count = await this.prisma.specialization.count({ where: { id: { in: ids } } });
    if (count !== ids.length) {
      throw new BadRequestException('One or more specializationIds do not exist');
    }
  }

  /** departmentIds are client-supplied; each must be a department belonging to this clinic (mirrors DepartmentsService.assertDoctorsExist). */
  private async assertDepartmentsExist(clinicId: string, ids: string[] | undefined): Promise<void> {
    if (!ids || ids.length === 0) return;
    const count = await this.prisma.department.count({
      where: { id: { in: ids }, clinicId, deletedAt: null },
    });
    if (count !== ids.length) {
      throw new BadRequestException('One or more departmentIds do not exist in this clinic');
    }
  }
}

function toDoctorResponseDto(doctor: DoctorWithRelations): DoctorResponseDto {
  const departments = doctor.departments.map((d) => ({
    id: d.department.id,
    name: d.department.name,
    code: d.department.code,
    branchId: d.department.branch.id,
    branchName: d.department.branch.name,
    branchCode: d.department.branch.code,
  }));
  const branches = Array.from(new Map(departments.map((d) => [d.branchId, d])).values()).map(
    (d) => ({ id: d.branchId, name: d.branchName, code: d.branchCode }),
  );

  return {
    id: doctor.id,
    clinicId: doctor.clinicId,
    userId: doctor.userId,
    firstName: doctor.user.firstName,
    lastName: doctor.user.lastName,
    email: doctor.user.email,
    phone: doctor.phone,
    licenseNumber: doctor.licenseNumber,
    qualification: doctor.qualification,
    bio: doctor.bio,
    consultationFee: doctor.consultationFee?.toString() ?? null,
    yearsOfExperience: doctor.yearsOfExperience,
    appointmentDurationMinutes: doctor.appointmentDurationMinutes,
    status: doctor.status,
    specializations: doctor.specializations.map((s) => s.specialization),
    departments,
    branches,
    createdAt: doctor.createdAt,
    updatedAt: doctor.updatedAt,
  };
}
