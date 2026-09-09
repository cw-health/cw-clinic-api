import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../guards/permissions.guard';
import { TenantGuard } from '../guards/tenant.guard';

export const ANY_PERMISSIONS_KEY = 'anyPermissions';

/**
 * Sibling to `@RequirePermissions()` for the rare case where a route should
 * be reachable by holding *any one* of several permissions (OR semantics)
 * rather than all of them (AND semantics) — e.g.
 * `GET /appointments/available-slots`, reachable by staff booking for a
 * patient (`appointments:create`) or a patient booking for themself
 * (`appointments:create-own`). `@RequirePermissions()` intentionally can't
 * express this (docs/RBAC.md §3: permission checks should stay simple/
 * explicit), so this is a small, separate metadata key/decorator rather
 * than overloading the existing one.
 *
 * Wires the same TenantGuard -> PermissionsGuard chain; PermissionsGuard
 * checks whichever of PERMISSIONS_KEY / ANY_PERMISSIONS_KEY is present.
 *
 * Example: `@RequireAnyPermission('appointments:create', 'appointments:create-own')`
 */
export const RequireAnyPermission = (...permissions: string[]) =>
  applyDecorators(
    SetMetadata(ANY_PERMISSIONS_KEY, permissions),
    UseGuards(TenantGuard, PermissionsGuard),
  );
