import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { JwtPayload } from '../interfaces/jwt-payload.interface';

/**
 * First link in the AuthGuard -> TenantGuard -> PermissionsGuard chain
 * (docs/SECURITY.md §3). Registered globally (APP_GUARD) so every route is
 * authenticated by default; `@Public()` is the explicit opt-out for
 * login/refresh.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  // Normalizes every failure (missing/expired/malformed token) to one
  // message — never leak which specific validation step failed.
  handleRequest<TUser = JwtPayload>(err: unknown, user: TUser | false): TUser {
    if (err || !user) {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    return user;
  }
}
