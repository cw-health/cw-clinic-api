import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../interfaces/jwt-payload.interface';

export interface TenantContext {
  clinicId: string | null;
  isSuperAdmin: boolean;
}

/**
 * Second link in the guard chain (docs/SECURITY.md §3). Derives tenant
 * context exclusively from the authenticated user's JWT claims — never
 * from a client-supplied body/query/header field (docs/SECURITY.md §4).
 *
 * A non-SuperAdmin user with no resolved clinic context cannot proceed.
 * If the route has a `:clinicId` path param (a resource nested under a
 * clinic), it must match the caller's own tenant unless they're a
 * SuperAdmin — this is the cross-tenant-access check exercised by the
 * guard's unit tests ahead of any resource module actually using it.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) throw new UnauthorizedException();

    if (!user.isSuperAdmin && !user.clinicId) {
      throw new ForbiddenException('No active clinic membership for this session');
    }

    const routeClinicId = (request as Request).params?.clinicId;
    if (routeClinicId && !user.isSuperAdmin && routeClinicId !== user.clinicId) {
      throw new ForbiddenException('Cross-clinic access denied');
    }

    (request as AuthenticatedRequest & { tenant: TenantContext }).tenant = {
      clinicId: user.clinicId,
      isSuperAdmin: user.isSuperAdmin,
    };

    return true;
  }
}
