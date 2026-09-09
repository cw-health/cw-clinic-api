import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { FeatureFlagsAdminController } from './feature-flags-admin.controller';

function contextFor(
  handlerName: keyof FeatureFlagsAdminController,
  user: JwtPayload | undefined,
  params: Record<string, string> = {},
): ExecutionContext {
  const request = { user, params };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Reflector reads metadata off this reference, it is never called here
    getHandler: () => FeatureFlagsAdminController.prototype[handlerName],
    getClass: () => FeatureFlagsAdminController,
  } as unknown as ExecutionContext;
}

const superAdmin: JwtPayload = {
  sub: 'admin-1',
  email: 'admin@platform.test',
  role: 'SuperAdmin',
  clinicId: null,
  clinicName: null,
  isSuperAdmin: true,
  permissions: ['super-admin:feature-flags-read'],
};

const clinicUser: JwtPayload = {
  sub: 'user-1',
  email: 'doctor@clinic-a.test',
  role: 'Doctor',
  clinicId: 'clinic-a',
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['appointments:read'],
};

/**
 * SA-08: the routes themselves are declared via `@RequirePermissions`
 * (feature-flags-admin.controller.ts), which wires TenantGuard ->
 * PermissionsGuard exactly like every other Super Admin controller. These
 * tests exercise that real chain against this controller's own metadata
 * rather than duplicating the guards' own generic unit tests.
 */
describe('FeatureFlagsAdminController authorization', () => {
  const permissionsGuard = new PermissionsGuard(new Reflector());
  const tenantGuard = new TenantGuard();

  it('denies a caller missing super-admin:feature-flags-manage on a mutating route', () => {
    expect(() => permissionsGuard.canActivate(contextFor('create', superAdmin))).toThrow(
      ForbiddenException,
    );
  });

  it('allows a caller holding super-admin:feature-flags-manage on a mutating route', () => {
    const manager = { ...superAdmin, permissions: ['super-admin:feature-flags-manage'] };
    expect(permissionsGuard.canActivate(contextFor('create', manager))).toBe(true);
  });

  it('denies a non-SuperAdmin clinic user entirely (no super-admin:* permission granted)', () => {
    expect(() => permissionsGuard.canActivate(contextFor('list', clinicUser))).toThrow(
      ForbiddenException,
    );
  });

  it('tenant isolation: denies a non-SuperAdmin caller overriding a flag for another clinic', () => {
    const context = contextFor('setOverride', clinicUser, { clinicId: 'clinic-b' });
    expect(() => tenantGuard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows a SuperAdmin to set an override for any clinic (route param bypass)', () => {
    const context = contextFor('setOverride', superAdmin, { clinicId: 'clinic-b' });
    expect(tenantGuard.canActivate(context)).toBe(true);
  });
});
