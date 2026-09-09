import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ClinicMembership, Prisma, Role, User } from '@prisma/client';
import { UserInvitationsService } from '../auth/user-invitations.service';
import { AuditService } from '../audit/audit.service';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateStaffDto } from './dto/create-staff.dto';
import type { QueryStaffDto } from './dto/query-staff.dto';
import type {
  AssignableRoleDto,
  StaffCreateResponseDto,
  StaffResponseDto,
} from './dto/staff-response.dto';
import type { UpdateStaffDto } from './dto/update-staff.dto';

/** Role names that exist as `Role` rows but are never assignable to staff via this module. */
const NON_STAFF_ROLE_NAMES = new Set(['SuperAdmin', 'Patient']);

type MembershipWithRelations = ClinicMembership & {
  user: User & { staffInvitation: { acceptedAt: Date | null } | null };
  role: Role;
  branch: { id: string; name: string; code: string } | null;
  department: { id: string; name: string; code: string } | null;
};

const STAFF_INCLUDE = {
  user: { include: { staffInvitation: { select: { acceptedAt: true } } } },
  role: true,
  branch: { select: { id: true, name: true, code: true } },
  department: { select: { id: true, name: true, code: true } },
} satisfies Prisma.ClinicMembershipInclude;

/**
 * Staff Management (Phase 1D, docs/RBAC.md's "Hospital -> Admin/Doctor/
 * Receptionist/Nurse/..." org chart). A "staff member" is a
 * `ClinicMembership` row — the User <-> Clinic <-> Role join already
 * defined by the RBAC architecture — not a new identity concept, per the
 * task brief ("avoid duplicating user information"). Every method takes
 * `clinicId` from the caller's resolved TenantContext (never client input,
 * docs/SECURITY.md §4) and every query/mutation is scoped to it — the same
 * tenant-isolation discipline as DoctorsService/DepartmentsService.
 *
 * Structural Super Admin protection: a Super Admin has no ClinicMembership
 * row at all (docs/RBAC.md §6 — `User.isSuperAdmin` is a platform-level
 * flag, never a membership/role pairing), so every query here — scoped to
 * `clinicId` through the ClinicMembership table — can never return, update,
 * or revoke a Super Admin account. There is nothing to bypass; the schema
 * itself makes it unreachable.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userInvitations: UserInvitationsService,
    private readonly auditService: AuditService,
  ) {}

  /** GET /staff/roles — the roles a ClinicAdmin may assign: clinic-visible system templates plus the clinic's own custom roles, minus SuperAdmin/Patient. */
  async listAssignableRoles(clinicId: string): Promise<AssignableRoleDto[]> {
    const roles = await this.prisma.role.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { clinicId: null, isSystem: true, name: { notIn: [...NON_STAFF_ROLE_NAMES] } },
          { clinicId },
        ],
      },
      orderBy: { name: 'asc' },
    });
    return roles.map((role) => ({ id: role.id, name: role.name, description: role.description }));
  }

  async invite(
    clinicId: string,
    dto: CreateStaffDto,
    actorUserId: string,
  ): Promise<StaffCreateResponseDto> {
    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingUser) throw new ConflictException('A user with this email already exists');

    const role = await this.assertAssignableRole(clinicId, dto.roleId);
    await this.assertBranchAndDepartment(clinicId, dto.branchId, dto.departmentId);

    const { membership, invitation } = await this.prisma.$transaction(async (tx) => {
      const { userId, invitation } = await this.userInvitations.createPendingUser(tx, {
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
      });

      const membership = await tx.clinicMembership.create({
        data: {
          userId,
          clinicId,
          roleId: role.id,
          branchId: dto.branchId,
          departmentId: dto.departmentId,
          status: 'ACTIVE',
        },
        include: STAFF_INCLUDE,
      });

      return { membership, invitation };
    });

    await this.recordAudit(clinicId, actorUserId, membership.id, 'INVITE', `role:${role.name}`);

    return { ...toStaffResponseDto(membership), invite: invitation };
  }

  async findAll(
    clinicId: string,
    query: QueryStaffDto,
  ): Promise<PaginatedResult<StaffResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.ClinicMembershipWhereInput = {
      clinicId,
      ...(query.roleId ? { roleId: query.roleId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            user: {
              OR: [
                { firstName: { contains: query.search } },
                { lastName: { contains: query.search } },
                { email: { contains: query.search } },
              ],
            },
          }
        : {}),
    };

    const sortBy = query.sortBy ?? 'name';
    const sortOrder = query.sortOrder ?? 'asc';
    const orderBy: Prisma.ClinicMembershipOrderByWithRelationInput =
      sortBy === 'name' ? { user: { firstName: sortOrder } } : { createdAt: sortOrder };

    const [total, memberships] = await this.prisma.$transaction([
      this.prisma.clinicMembership.count({ where }),
      this.prisma.clinicMembership.findMany({
        where,
        include: STAFF_INCLUDE,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data: memberships.map(toStaffResponseDto),
      meta: { total, page, pageSize },
    };
  }

  async findById(clinicId: string, id: string): Promise<StaffResponseDto> {
    const membership = await this.findMembershipOrThrow(clinicId, id);
    return toStaffResponseDto(membership);
  }

  async update(
    clinicId: string,
    id: string,
    dto: UpdateStaffDto,
    actorUserId: string,
  ): Promise<StaffResponseDto> {
    const existing = await this.findMembershipOrThrow(clinicId, id);

    const membership = await this.prisma.clinicMembership.update({
      where: { id: existing.id },
      data: {
        user: {
          update: {
            ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
            ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
          },
        },
      },
      include: STAFF_INCLUDE,
    });

    await this.recordAudit(
      clinicId,
      actorUserId,
      membership.id,
      'UPDATE',
      Object.keys(dto).join(','),
    );
    return toStaffResponseDto(membership);
  }

  async assignRole(
    clinicId: string,
    id: string,
    roleId: string,
    actorUserId: string,
  ): Promise<StaffResponseDto> {
    await this.findMembershipOrThrow(clinicId, id);
    const role = await this.assertAssignableRole(clinicId, roleId);

    const membership = await this.prisma.clinicMembership.update({
      where: { id },
      data: { roleId: role.id },
      include: STAFF_INCLUDE,
    });
    await this.recordAudit(
      clinicId,
      actorUserId,
      membership.id,
      'ASSIGN_ROLE',
      `role:${role.name}`,
    );
    return toStaffResponseDto(membership);
  }

  async assignBranch(
    clinicId: string,
    id: string,
    branchId: string | null | undefined,
    actorUserId: string,
  ): Promise<StaffResponseDto> {
    const existing = await this.findMembershipOrThrow(clinicId, id);
    await this.assertBranchAndDepartment(
      clinicId,
      branchId ?? undefined,
      existing.departmentId ?? undefined,
    );

    const membership = await this.prisma.clinicMembership.update({
      where: { id },
      data: { branchId: branchId ?? null },
      include: STAFF_INCLUDE,
    });
    await this.recordAudit(clinicId, actorUserId, membership.id, 'ASSIGN_BRANCH', 'branchId');
    return toStaffResponseDto(membership);
  }

  async assignDepartment(
    clinicId: string,
    id: string,
    departmentId: string | null | undefined,
    actorUserId: string,
  ): Promise<StaffResponseDto> {
    const existing = await this.findMembershipOrThrow(clinicId, id);
    await this.assertBranchAndDepartment(
      clinicId,
      existing.branchId ?? undefined,
      departmentId ?? undefined,
    );

    const membership = await this.prisma.clinicMembership.update({
      where: { id },
      data: { departmentId: departmentId ?? null },
      include: STAFF_INCLUDE,
    });
    await this.recordAudit(
      clinicId,
      actorUserId,
      membership.id,
      'ASSIGN_DEPARTMENT',
      'departmentId',
    );
    return toStaffResponseDto(membership);
  }

  async updateStatus(
    clinicId: string,
    id: string,
    status: 'ACTIVE' | 'INACTIVE',
    actorUserId: string,
  ): Promise<StaffResponseDto> {
    const existing = await this.findMembershipOrThrow(clinicId, id);
    if (status === 'INACTIVE' && existing.userId === actorUserId) {
      throw new ForbiddenException('You cannot deactivate your own access');
    }

    const membership = await this.prisma.clinicMembership.update({
      where: { id },
      data: { status },
      include: STAFF_INCLUDE,
    });
    await this.recordAudit(
      clinicId,
      actorUserId,
      membership.id,
      status === 'ACTIVE' ? 'ACTIVATE' : 'DEACTIVATE',
    );
    return toStaffResponseDto(membership);
  }

  /** POST /staff/:id/resend-invite — regenerates the invite token for a still-PENDING staff account. */
  async resendInvite(
    clinicId: string,
    id: string,
    actorUserId: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const existing = await this.findMembershipOrThrow(clinicId, id);
    const invitation = await this.userInvitations.resend(existing.userId);
    await this.recordAudit(clinicId, actorUserId, existing.id, 'RESEND_INVITE');
    return invitation;
  }

  /**
   * "Revoke access" — stronger than a plain deactivate: sets the
   * membership INACTIVE (blocks any future login for this clinic, per
   * AuthContextService.resolve's `status: 'ACTIVE'` filter) AND revokes
   * every outstanding refresh token so an already-live session is killed
   * immediately, not just at its next silent refresh. Any unaccepted
   * invitation is expired in the same step so a stale invite link can't be
   * used to activate the account later.
   */
  async revokeAccess(clinicId: string, id: string, actorUserId: string): Promise<StaffResponseDto> {
    const existing = await this.findMembershipOrThrow(clinicId, id);
    if (existing.userId === actorUserId) {
      throw new ForbiddenException('You cannot revoke your own access');
    }

    const [membership] = await this.prisma.$transaction([
      this.prisma.clinicMembership.update({
        where: { id },
        data: { status: 'INACTIVE' },
        include: STAFF_INCLUDE,
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.staffInvitation.updateMany({
        where: { userId: existing.userId, acceptedAt: null },
        data: { expiresAt: new Date() },
      }),
    ]);

    await this.recordAudit(clinicId, actorUserId, membership.id, 'REVOKE_ACCESS');
    return toStaffResponseDto(membership);
  }

  private async recordAudit(
    clinicId: string,
    actorUserId: string,
    membershipId: string,
    action: string,
    changedFields?: string,
  ): Promise<void> {
    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'ClinicMembership',
      entityId: membershipId,
      action,
      changedFields,
    });
  }

  private async findMembershipOrThrow(
    clinicId: string,
    id: string,
  ): Promise<MembershipWithRelations> {
    const membership = await this.prisma.clinicMembership.findFirst({
      where: { id, clinicId },
      include: STAFF_INCLUDE,
    });
    if (!membership) throw new NotFoundException('Staff member not found');
    return membership;
  }

  /**
   * A roleId is client-supplied and must never be trusted without
   * verifying it is one the caller may actually assign (docs/SECURITY.md
   * §4): either this clinic's own custom Role, or a system template other
   * than SuperAdmin/Patient. Rejecting SuperAdmin here is the concrete
   * enforcement of "Do not allow clinic administrators to create Super
   * Admin accounts" / "cannot assign platform roles".
   */
  private async assertAssignableRole(clinicId: string, roleId: string): Promise<Role> {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role || role.status !== 'ACTIVE') {
      throw new BadRequestException('roleId does not exist');
    }
    if (role.clinicId === null && role.name === 'SuperAdmin') {
      throw new ForbiddenException('Cannot assign the platform SuperAdmin role to clinic staff');
    }
    if (NON_STAFF_ROLE_NAMES.has(role.name)) {
      throw new BadRequestException(`Cannot assign the ${role.name} role to staff`);
    }
    if (role.clinicId !== null && role.clinicId !== clinicId) {
      throw new BadRequestException('roleId does not belong to this clinic');
    }
    if (role.clinicId === null && !role.isSystem) {
      throw new BadRequestException('roleId does not exist');
    }
    return role;
  }

  /** branchId/departmentId are client-supplied — both must belong to the caller's own clinic, and a given department must belong to the given branch when both are present. */
  private async assertBranchAndDepartment(
    clinicId: string,
    branchId: string | undefined,
    departmentId: string | undefined,
  ): Promise<void> {
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, clinicId, deletedAt: null },
      });
      if (!branch) throw new BadRequestException('branchId does not belong to this clinic');
    }
    if (departmentId) {
      const department = await this.prisma.department.findFirst({
        where: { id: departmentId, clinicId, deletedAt: null },
      });
      if (!department) throw new BadRequestException('departmentId does not belong to this clinic');
      if (branchId && department.branchId !== branchId) {
        throw new BadRequestException('departmentId does not belong to the given branchId');
      }
    }
  }
}

function toStaffResponseDto(membership: MembershipWithRelations): StaffResponseDto {
  return {
    id: membership.id,
    userId: membership.userId,
    clinicId: membership.clinicId,
    firstName: membership.user.firstName,
    lastName: membership.user.lastName,
    email: membership.user.email,
    status: membership.status,
    userStatus: membership.user.status,
    role: {
      id: membership.role.id,
      name: membership.role.name,
      description: membership.role.description,
    },
    branch: membership.branch,
    department: membership.department,
    invitePending:
      membership.user.status === 'PENDING' && !membership.user.staffInvitation?.acceptedAt,
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
  };
}
