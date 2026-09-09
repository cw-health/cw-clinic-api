import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Forgot-password is already covered by the global per-IP throttle
 * (app.module.ts) plus its own tighter `@Throttle` limit on the route —
 * this guard adds a second, IP+account-keyed bucket on top of that
 * (docs/SECURITY.md §6: "keyed by IP + account identifier where
 * applicable... not IP alone"), so many attempts against one account
 * spread across different IPs are still bounded. Used only on
 * POST /auth/forgot-password — does not touch login/refresh throttling.
 */
@Injectable()
export class PasswordResetThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const body = req.body as Record<string, unknown> | undefined;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const ip = typeof req.ip === 'string' ? req.ip : 'unknown';
    return Promise.resolve(`${ip}:${email}`);
  }
}
