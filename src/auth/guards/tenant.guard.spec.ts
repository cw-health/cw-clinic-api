import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { TenantGuard } from './tenant.guard';
import type { JwtPayload } from '../interfaces/jwt-payload.interface';

function contextFor(
  user: JwtPayload | undefined,
  params: Record<string, string> = {},
): ExecutionContext {
  const request = { user, params };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const basePayload: JwtPayload = {
  sub: 'user-1',
  email: 'doctor@clinic-a.test',
  role: 'Doctor',
  clinicId: 'clinic-a',
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['appointments:read'],
};

describe('TenantGuard', () => {
  const guard = new TenantGuard();

  it('allows a request with a resolved clinic context', () => {
    expect(guard.canActivate(contextFor(basePayload))).toBe(true);
  });

  it('denies a non-SuperAdmin user with no clinic membership', () => {
    const user = { ...basePayload, clinicId: null };
    expect(() => guard.canActivate(contextFor(user))).toThrow(ForbiddenException);
  });

  it('denies cross-clinic access when the route clinicId does not match the caller tenant', () => {
    const context = contextFor(basePayload, { clinicId: 'clinic-b' });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows same-clinic access when the route clinicId matches the caller tenant', () => {
    const context = contextFor(basePayload, { clinicId: 'clinic-a' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a SuperAdmin to bypass the clinicId route-param match', () => {
    const superAdmin: JwtPayload = {
      ...basePayload,
      isSuperAdmin: true,
      clinicId: null,
      role: 'SuperAdmin',
    };
    const context = contextFor(superAdmin, { clinicId: 'clinic-b' });
    expect(guard.canActivate(context)).toBe(true);
  });
});
