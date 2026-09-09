import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { TenantContext } from '../guards/tenant.guard';

/** Pulls the TenantContext attached by TenantGuard. Only valid on routes behind that guard (any route using @RequirePermissions). */
export const Tenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const request = ctx.switchToHttp().getRequest<Request & { tenant: TenantContext }>();
    return request.tenant;
  },
);
