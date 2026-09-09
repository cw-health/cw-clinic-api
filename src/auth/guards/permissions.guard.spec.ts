import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import type { JwtPayload } from '../interfaces/jwt-payload.interface';

function contextFor(user: JwtPayload, required: string[] | undefined): ExecutionContext {
  const request = { user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
    __required: required,
  } as unknown as ExecutionContext;
}

function guardWithKeyed(byKey: Record<string, string[] | undefined>) {
  const reflector = {
    getAllAndOverride: (key: string) => byKey[key],
  } as unknown as Reflector;
  return new PermissionsGuard(reflector);
}

const user: JwtPayload = {
  sub: 'user-1',
  email: 'frontdesk@clinic-a.test',
  role: 'FrontDesk',
  clinicId: 'clinic-a',
  clinicName: 'Clinic A',
  isSuperAdmin: false,
  permissions: ['patients:read', 'patients:create'],
};

function guardWith(required: string[] | undefined) {
  const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
  return new PermissionsGuard(reflector);
}

describe('PermissionsGuard', () => {
  it('allows a route with no declared permission requirement', () => {
    const guard = guardWith(undefined);
    expect(guard.canActivate(contextFor(user, undefined))).toBe(true);
  });

  it('allows when the user holds all required permissions', () => {
    const guard = guardWith(['patients:read']);
    expect(guard.canActivate(contextFor(user, ['patients:read']))).toBe(true);
  });

  it('denies when the user is missing a required permission', () => {
    const guard = guardWith(['billing:refund']);
    expect(() => guard.canActivate(contextFor(user, ['billing:refund']))).toThrow(
      ForbiddenException,
    );
  });

  it('denies a SuperAdmin lacking a clinical permission (not an automatic bypass)', () => {
    const superAdmin: JwtPayload = {
      ...user,
      isSuperAdmin: true,
      role: 'SuperAdmin',
      clinicId: null,
      permissions: ['clinics:read'],
    };
    const guard = guardWith(['patients:read']);
    expect(() => guard.canActivate(contextFor(superAdmin, ['patients:read']))).toThrow(
      ForbiddenException,
    );
  });

  it('allows a SuperAdmin holding the required super-admin:* permission', () => {
    const superAdmin: JwtPayload = {
      ...user,
      isSuperAdmin: true,
      role: 'SuperAdmin',
      clinicId: null,
      permissions: ['super-admin:clinics-read'],
    };
    const guard = guardWith(['super-admin:clinics-read']);
    expect(guard.canActivate(contextFor(superAdmin, ['super-admin:clinics-read']))).toBe(true);
  });

  it('denies a SuperAdmin missing a required super-admin:* permission (still not an automatic bypass)', () => {
    const superAdmin: JwtPayload = {
      ...user,
      isSuperAdmin: true,
      role: 'SuperAdmin',
      clinicId: null,
      permissions: ['super-admin:clinics-read'],
    };
    const guard = guardWith(['super-admin:plans-manage']);
    expect(() => guard.canActivate(contextFor(superAdmin, ['super-admin:plans-manage']))).toThrow(
      ForbiddenException,
    );
  });

  it('denies a normal tenant user attempting to use a super-admin:* permission', () => {
    const guard = guardWith(['super-admin:clinics-read']);
    expect(() => guard.canActivate(contextFor(user, ['super-admin:clinics-read']))).toThrow(
      ForbiddenException,
    );
  });

  describe('@RequireAnyPermission (OR semantics)', () => {
    it('allows when the user holds only one of the listed permissions', () => {
      const guard = guardWithKeyed({
        permissions: undefined,
        anyPermissions: ['appointments:create', 'appointments:create-own'],
      });
      const patientUser: JwtPayload = { ...user, permissions: ['appointments:create-own'] };
      expect(guard.canActivate(contextFor(patientUser, undefined))).toBe(true);
    });

    it('denies when the user holds none of the listed permissions', () => {
      const guard = guardWithKeyed({
        permissions: undefined,
        anyPermissions: ['appointments:create', 'appointments:create-own'],
      });
      expect(() => guard.canActivate(contextFor(user, undefined))).toThrow(ForbiddenException);
    });
  });
});
