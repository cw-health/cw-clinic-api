import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Request-scoped metadata for an AuditService.record() call — never a substitute for the `entity`/`action` business fact, just where/who-adjacent context. */
export interface AuditRequestContext {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Pulls request-correlation/network metadata for an audited write — reused
 * across controllers instead of each one hand-rolling `@Req()` access.
 * Deliberately a plain param decorator, not interceptor/middleware magic:
 * a controller method that wants this passes it to the service explicitly,
 * same as any other argument, so the audit call site stays readable.
 */
export const AuditContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuditRequestContext => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const requestIdHeader = req.headers['x-request-id'];
    const userAgentHeader = req.headers['user-agent'];
    return {
      requestId: typeof requestIdHeader === 'string' ? requestIdHeader : undefined,
      ipAddress: req.ip,
      userAgent: typeof userAgentHeader === 'string' ? userAgentHeader : undefined,
    };
  },
);
