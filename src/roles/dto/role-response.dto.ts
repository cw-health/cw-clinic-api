/** One row of the role list — GET /roles. */
export interface RoleSummaryDto {
  id: string;
  name: string;
  description: string | null;
  /** Platform template (Role.clinicId is null) vs. this clinic's own custom role. */
  isSystem: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  permissionCount: number;
  /** Active staff in this clinic currently holding this role. */
  userCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PermissionDto {
  key: string;
  description: string;
  category: string;
}

/** GET /roles/:id — the summary fields plus the role's full permission grant. */
export interface RoleDetailDto extends RoleSummaryDto {
  permissions: PermissionDto[];
}

/** One grouped section of GET /roles/permissions/catalog — one clinic-relevant module. */
export interface PermissionCatalogModuleDto {
  category: string;
  /** Human-facing module name for the admin UI (docs/RBAC.md's module list). */
  label: string;
  permissions: PermissionDto[];
}

/** One row of GET /roles/:id/users — a staff member currently holding the role. */
export interface RoleUserDto {
  membershipId: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE';
}
