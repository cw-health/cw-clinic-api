import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../guards/permissions.guard';
import { TenantGuard } from '../guards/tenant.guard';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Declares the permission(s) a route requires (ANDed — all must be held)
 * and wires the TenantGuard -> PermissionsGuard chain per docs/SECURITY.md
 * §3. AuthGuard runs earlier as the global guard, so the order here
 * completes the required "AuthGuard -> TenantGuard -> PermissionsGuard"
 * sequence without every controller re-declaring it.
 *
 * Example: `@RequirePermissions('patients:read')`
 */
export const RequirePermissions = (...permissions: string[]) =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    UseGuards(TenantGuard, PermissionsGuard),
  );
