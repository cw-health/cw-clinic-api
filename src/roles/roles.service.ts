import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Permission, Prisma, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateRoleDto } from './dto/create-role.dto';
import type { QueryRolesDto } from './dto/query-roles.dto';
import type {
  PermissionCatalogModuleDto,
  PermissionDto,
  RoleDetailDto,
  RoleSummaryDto,
  RoleUserDto,
} from './dto/role-response.dto';
import type { ArchiveRoleDto, UpdateRoleDto } from './dto/update-role.dto';

/**
 * Role names that exist as system `Role` rows but are never surfaced or
 * assignable through clinic-facing role management — SuperAdmin is a
 * platform identity flag, never a clinic-configurable role (docs/RBAC.md
 * §6), and Patient is a self-service identity, not staff (mirrors
 * `NON_STAFF_ROLE_NAMES` in `../staff/staff.service.ts`, kept as a separate
 * constant since the two modules must not import each other's private
 * details).
 */
const NON_CLINIC_ROLE_NAMES = new Set(['SuperAdmin', 'Patient']);

/**
 * Permission categories that are platform-only (`clinics:*`, the tenant
 * registry; `super-admin:*`, the platform-operations console). A clinic
 * admin must never see these in the permission catalog, nor grant them to
 * any custom role — this is the concrete enforcement of "must not modify
 * platform permissions" / "must not grant themselves Super Admin
 * privileges" (docs/RBAC.md §6, task security brief).
 */
const PLATFORM_ONLY_CATEGORIES = new Set(['clinics', 'super-admin']);

/** Human-facing module names for the permission catalog (docs/RBAC.md's module list). Falls back to a title-cased category for anything not listed. */
const MODULE_LABELS: Record<string, string> = {
  patients: 'Patients',
  appointments: 'Appointments',
  queue: 'Queue',
  consultations: 'Consultations',
  // Clinical Record upgrade (docs/DATABASE.md §16) — investigations:* is
  // its own category (diagnoses:* stays folded under consultations),
  // since LabTechnician needs a scoped grant here ahead of a future Lab
  // module.
  investigations: 'Investigations',
  prescriptions: 'Prescriptions',
  billing: 'Billing',
  payments: 'Payments',
  medicines: 'Pharmacy',
  reports: 'Reports',
  users: 'Staff',
  roles: 'Roles',
  'clinic-settings': 'Settings',
  branches: 'Branches',
  departments: 'Departments',
  doctors: 'Doctors',
  documents: 'Documents',
  notifications: 'Notifications',
};

type RoleWithCounts = Role & {
  _count: { rolePermissions: number };
};

/**
 * Clinic Role & Permission Management (Phase 1E, docs/RBAC.md §1-2). Builds
 * a usable admin experience on top of the existing DB-driven
 * Role/Permission/RolePermission/PermissionsGuard architecture — this
 * module never bypasses `PermissionsGuard` and never introduces a
 * permission key that isn't already enforced somewhere in the codebase
 * (see `../../prisma/data/permissions.ts`).
 *
 * Role types: a `Role` is either a **system template**
 * (`clinicId: null, isSystem: true`, e.g. Doctor/FrontDesk/Billing) or a
 * **clinic custom role** (`clinicId: <this clinic>, isSystem: false`).
 * System templates are read-only through this module — a clinic admin can
 * view them (to see what a template grants before basing a custom role on
 * it) but can never rename them, edit their permissions, or archive them.
 * Only a clinic's own custom roles are mutable, and only within that
 * clinic — every query/mutation here is scoped by `clinicId` from the
 * caller's resolved TenantContext, never client input (docs/SECURITY.md
 * §4), the same tenant-isolation discipline as Branches/Departments/Staff.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** GET /roles/permissions/catalog — the permission keys a clinic admin may organize a role around, grouped by module. Never includes a platform-only category. */
  async getPermissionCatalog(): Promise<PermissionCatalogModuleDto[]> {
    const permissions = await this.prisma.permission.findMany({
      where: { category: { notIn: [...PLATFORM_ONLY_CATEGORIES] } },
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });

    const byCategory = new Map<string, PermissionDto[]>();
    for (const permission of permissions) {
      const category = permission.category ?? 'other';
      const bucket = byCategory.get(category) ?? [];
      bucket.push(toPermissionDto(permission));
      byCategory.set(category, bucket);
    }

    return Array.from(byCategory.entries()).map(([category, perms]) => ({
      category,
      label: MODULE_LABELS[category] ?? titleCase(category),
      permissions: perms,
    }));
  }

  /** GET /roles — system templates (minus SuperAdmin/Patient) plus this clinic's own custom roles. */
  async findAll(clinicId: string, query: QueryRolesDto): Promise<PaginatedResult<RoleSummaryDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const visibility: Prisma.RoleWhereInput =
      query.type === 'system'
        ? { clinicId: null, isSystem: true, name: { notIn: [...NON_CLINIC_ROLE_NAMES] } }
        : query.type === 'custom'
          ? { clinicId }
          : {
              OR: [
                { clinicId: null, isSystem: true, name: { notIn: [...NON_CLINIC_ROLE_NAMES] } },
                { clinicId },
              ],
            };

    const where: Prisma.RoleWhereInput = {
      AND: [
        visibility,
        query.status ? { status: query.status } : {},
        query.search ? { name: { contains: query.search } } : {},
      ],
    };

    const [total, roles] = await this.prisma.$transaction([
      this.prisma.role.count({ where }),
      this.prisma.role.findMany({
        where,
        include: { _count: { select: { rolePermissions: true } } },
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const userCounts = await this.countActiveUsersByRole(
      clinicId,
      roles.map((role) => role.id),
    );

    return {
      data: roles.map((role) => toRoleSummaryDto(role, userCounts.get(role.id) ?? 0)),
      meta: { total, page, pageSize },
    };
  }

  /** GET /roles/:id */
  async findById(clinicId: string, id: string): Promise<RoleDetailDto> {
    const role = await this.findVisibleRoleOrThrow(clinicId, id);
    const permissions = await this.prisma.permission.findMany({
      where: { rolePermissions: { some: { roleId: id } } },
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });
    const userCounts = await this.countActiveUsersByRole(clinicId, [id]);

    return {
      ...toRoleSummaryDto(role, userCounts.get(id) ?? 0),
      permissions: permissions.map(toPermissionDto),
    };
  }

  /** GET /roles/:id/users — the clinic's own staff currently holding this role (system or custom). */
  async listUsers(
    clinicId: string,
    id: string,
    query: { page?: number; pageSize?: number },
  ): Promise<PaginatedResult<RoleUserDto>> {
    await this.findVisibleRoleOrThrow(clinicId, id);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.ClinicMembershipWhereInput = { clinicId, roleId: id };

    const [total, memberships] = await this.prisma.$transaction([
      this.prisma.clinicMembership.count({ where }),
      this.prisma.clinicMembership.findMany({
        where,
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data: memberships.map((membership) => ({
        membershipId: membership.id,
        userId: membership.user.id,
        firstName: membership.user.firstName,
        lastName: membership.user.lastName,
        email: membership.user.email,
        status: membership.status as 'ACTIVE' | 'INACTIVE',
      })),
      meta: { total, page, pageSize },
    };
  }

  /** POST /roles — create a custom role owned by the caller's own clinic. */
  async create(clinicId: string, actorUserId: string, dto: CreateRoleDto): Promise<RoleDetailDto> {
    await this.assertNameAvailable(clinicId, dto.name);
    const permissions = await this.assertAssignablePermissionKeys(dto.permissionKeys);

    const role = await this.prisma.role.create({
      data: {
        clinicId,
        name: dto.name,
        description: dto.description,
        isSystem: false,
        status: 'ACTIVE',
        rolePermissions: {
          create: permissions.map((permission) => ({ permissionId: permission.id })),
        },
      },
    });

    await this.recordAudit(clinicId, actorUserId, role.id, 'CREATE', 'name,permissions');
    return this.findById(clinicId, role.id);
  }

  /** PATCH /roles/:id — rename/re-describe/re-permission the caller's own custom role. System templates are never editable here. */
  async update(
    clinicId: string,
    id: string,
    actorUserId: string,
    dto: UpdateRoleDto,
  ): Promise<RoleDetailDto> {
    const role = await this.findOwnCustomRoleOrThrow(clinicId, id);
    if (role.status === 'INACTIVE') {
      throw new ConflictException('An archived role cannot be updated');
    }

    if (dto.name && dto.name !== role.name) {
      await this.assertNameAvailable(clinicId, dto.name, id);
    }

    const changed: string[] = [];
    if (dto.name !== undefined) changed.push('name');
    if (dto.description !== undefined) changed.push('description');

    await this.prisma.role.update({
      where: { id },
      data: { name: dto.name, description: dto.description },
    });

    if (dto.permissionKeys) {
      const permissions = await this.assertAssignablePermissionKeys(dto.permissionKeys);
      // SQL Server's connector doesn't support createMany's skipDuplicates
      // (same constraint as prisma/seed-reference-data.ts), so the grant
      // set is replaced wholesale in one transaction rather than diffed.
      await this.prisma.$transaction([
        this.prisma.rolePermission.deleteMany({ where: { roleId: id } }),
        this.prisma.rolePermission.createMany({
          data: permissions.map((permission) => ({ roleId: id, permissionId: permission.id })),
        }),
      ]);
      changed.push('permissions');
    }

    if (changed.length > 0) {
      await this.recordAudit(clinicId, actorUserId, id, 'UPDATE', changed.join(','));
    }

    return this.findById(clinicId, id);
  }

  /**
   * POST /roles/:id/archive — deactivate a custom role. A role still
   * actively held by staff cannot simply vanish out from under them: if
   * any ACTIVE ClinicMembership in this clinic points at it, the caller
   * must supply `reassignToRoleId` (an assignable role in this same
   * clinic) so those memberships move there first, in the same
   * transaction as the archive. Without one, this throws instead of
   * silently leaving staff on a deactivated role.
   */
  async archive(
    clinicId: string,
    id: string,
    actorUserId: string,
    dto: ArchiveRoleDto,
  ): Promise<RoleDetailDto> {
    const role = await this.findOwnCustomRoleOrThrow(clinicId, id);
    if (role.status === 'INACTIVE') {
      throw new ConflictException('Role is already archived');
    }

    const activeCount = await this.prisma.clinicMembership.count({
      where: { clinicId, roleId: id, status: 'ACTIVE' },
    });

    if (activeCount > 0) {
      if (!dto.reassignToRoleId) {
        throw new ConflictException(
          `${activeCount} active staff member(s) are still assigned to this role. ` +
            'Provide reassignToRoleId to move them to another role before archiving.',
        );
      }
      if (dto.reassignToRoleId === id) {
        throw new BadRequestException('reassignToRoleId must be a different role');
      }
      const target = await this.assertAssignableRole(clinicId, dto.reassignToRoleId);

      await this.prisma.$transaction([
        this.prisma.clinicMembership.updateMany({
          where: { clinicId, roleId: id, status: 'ACTIVE' },
          data: { roleId: target.id },
        }),
        this.prisma.role.update({ where: { id }, data: { status: 'INACTIVE' } }),
      ]);
      await this.recordAudit(
        clinicId,
        actorUserId,
        id,
        'ARCHIVE',
        `reassigned:${activeCount}->${target.id}`,
      );
    } else {
      await this.prisma.role.update({ where: { id }, data: { status: 'INACTIVE' } });
      await this.recordAudit(clinicId, actorUserId, id, 'ARCHIVE');
    }

    return this.findById(clinicId, id);
  }

  /**
   * A role a caller may see, either their own clinic's custom role or a
   * clinic-visible system template — never another clinic's custom role,
   * never SuperAdmin/Patient (docs/SECURITY.md §4: never trust a
   * client-supplied id without verifying it belongs to the caller's own
   * scope).
   */
  private async findVisibleRoleOrThrow(clinicId: string, id: string): Promise<RoleWithCounts> {
    const role = await this.prisma.role.findFirst({
      where: {
        id,
        OR: [
          { clinicId },
          { clinicId: null, isSystem: true, name: { notIn: [...NON_CLINIC_ROLE_NAMES] } },
        ],
      },
      include: { _count: { select: { rolePermissions: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  /** A role the caller may actually modify: must be this clinic's own custom role. */
  private async findOwnCustomRoleOrThrow(clinicId: string, id: string): Promise<Role> {
    const role = await this.prisma.role.findFirst({ where: { id, clinicId } });
    if (!role) {
      // Distinguishes "doesn't exist / not yours" (404) from "exists but is
      // a system template" (403) only once we know which case it is, so a
      // clinic admin can't probe for another clinic's role ids via the
      // error type.
      const systemRole = await this.prisma.role.findFirst({
        where: { id, clinicId: null, isSystem: true },
      });
      if (systemRole) {
        throw new ForbiddenException('System role templates cannot be modified');
      }
      throw new NotFoundException('Role not found');
    }
    if (role.isSystem) {
      throw new ForbiddenException('System role templates cannot be modified');
    }
    return role;
  }

  /** Same assignability rule as `StaffService.assertAssignableRole` (kept local since the two modules must not reach into each other's private methods, docs/ARCHITECTURE.md §3): this clinic's own role, or a system template other than SuperAdmin/Patient. */
  private async assertAssignableRole(clinicId: string, roleId: string): Promise<Role> {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role || role.status !== 'ACTIVE') {
      throw new BadRequestException('reassignToRoleId does not exist or is not active');
    }
    if (NON_CLINIC_ROLE_NAMES.has(role.name) && role.clinicId === null) {
      throw new BadRequestException(`Cannot reassign staff to the ${role.name} role`);
    }
    if (role.clinicId !== null && role.clinicId !== clinicId) {
      throw new BadRequestException('reassignToRoleId does not belong to this clinic');
    }
    if (role.clinicId === null && !role.isSystem) {
      throw new BadRequestException('reassignToRoleId does not exist');
    }
    return role;
  }

  /**
   * Privilege-escalation guard: every key must (a) exist in the seeded
   * Permission catalog and (b) not belong to a platform-only category.
   * This is the concrete enforcement behind "a clinic admin must not grant
   * themselves Super Admin privileges" / "must not modify platform
   * permissions" — there is no code path in this service that can attach
   * a `clinics:*` or `super-admin:*` permission to any clinic role.
   */
  private async assertAssignablePermissionKeys(keys: string[]): Promise<Permission[]> {
    if (keys.length === 0) {
      throw new BadRequestException('A role must have at least one permission');
    }
    const permissions = await this.prisma.permission.findMany({ where: { key: { in: keys } } });

    const found = new Set(permissions.map((permission) => permission.key));
    const unknown = keys.filter((key) => !found.has(key));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown permission key(s): ${unknown.join(', ')}`);
    }

    const platformOnly = permissions.filter(
      (permission) => permission.category && PLATFORM_ONLY_CATEGORIES.has(permission.category),
    );
    if (platformOnly.length > 0) {
      throw new ForbiddenException(
        `Cannot grant platform-only permission(s) to a clinic role: ${platformOnly
          .map((permission) => permission.key)
          .join(', ')}`,
      );
    }

    return permissions;
  }

  /** Custom role names must be unique within the clinic, and must not shadow a system template's name (staff-facing role pickers key templates by name, docs/staff.service.ts). */
  private async assertNameAvailable(
    clinicId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.prisma.role.findFirst({
      where: {
        name,
        OR: [{ clinicId }, { clinicId: null, isSystem: true }],
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (clash) throw new ConflictException('A role with this name already exists');
  }

  private async countActiveUsersByRole(
    clinicId: string,
    roleIds: string[],
  ): Promise<Map<string, number>> {
    if (roleIds.length === 0) return new Map();
    const grouped = await this.prisma.clinicMembership.groupBy({
      by: ['roleId'],
      where: { clinicId, roleId: { in: roleIds }, status: 'ACTIVE' },
      _count: { _all: true },
    });
    return new Map(grouped.map((row) => [row.roleId, row._count._all]));
  }

  private async recordAudit(
    clinicId: string,
    actorUserId: string,
    roleId: string,
    action: string,
    changedFields?: string,
  ): Promise<void> {
    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Role',
      entityId: roleId,
      action,
      changedFields,
    });
  }
}

function toPermissionDto(permission: Permission): PermissionDto {
  return {
    key: permission.key,
    description: permission.description,
    category: permission.category ?? 'other',
  };
}

function toRoleSummaryDto(role: RoleWithCounts, userCount: number): RoleSummaryDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    status: role.status as 'ACTIVE' | 'INACTIVE',
    permissionCount: role._count.rolePermissions,
    userCount,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

function titleCase(value: string): string {
  return value
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
