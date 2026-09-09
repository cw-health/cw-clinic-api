import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY } from '../decorators/require-any-permission.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { AuthenticatedRequest } from '../interfaces/jwt-payload.interface';

/**
 * Third link in the guard chain (docs/SECURITY.md §3). Checks the
 * permission(s) declared via `@RequirePermissions(...)` (AND semantics —
 * all listed permissions must be held) or `@RequireAnyPermission(...)` (OR
 * semantics — any one is enough) against the caller's embedded permission
 * set. SuperAdmin is not an automatic bypass, since per docs/RBAC.md §2 its
 * permission set is deliberately narrow (`clinics:*`), not "can do
 * everything".
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredAny = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const granted = new Set(request.user?.permissions ?? []);

    if (required && required.length > 0) {
      const missing = required.filter((permission) => !granted.has(permission));
      if (missing.length > 0) {
        throw new ForbiddenException(`Missing required permission(s): ${missing.join(', ')}`);
      }
    }

    if (requiredAny && requiredAny.length > 0) {
      const hasAny = requiredAny.some((permission) => granted.has(permission));
      if (!hasAny) {
        throw new ForbiddenException(
          `Missing required permission (any of): ${requiredAny.join(', ')}`,
        );
      }
    }

    return true;
  }
}
