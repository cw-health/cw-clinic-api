import { ForbiddenException } from '@nestjs/common';
import type { TenantContext } from '../auth/guards/tenant.guard';

/**
 * Narrows a resolved TenantContext to a non-null clinicId for clinic-scoped
 * modules (doctors, patients, clinic settings). In practice this never
 * throws for a request that reached the service layer: only clinic-scoped
 * roles hold the permissions these routes require (docs/RBAC.md §2), and a
 * SuperAdmin session has no clinicId — but it's a real, not merely
 * defensive, check: clinicId is never assumed present without verifying it
 * (docs/SECURITY.md §4).
 */
export function requireClinicId(tenant: TenantContext): string {
  if (!tenant.clinicId) {
    throw new ForbiddenException('This action requires an active clinic membership');
  }
  return tenant.clinicId;
}
