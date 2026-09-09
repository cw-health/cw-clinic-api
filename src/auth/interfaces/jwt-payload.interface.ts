import type { Request } from 'express';

/**
 * Access-token claims. Permissions and tenant context are embedded at
 * issuance (docs/RBAC.md §3: "returned at login / via a /me endpoint") so
 * every protected request can be authorized without a DB round trip — the
 * short access-token lifetime (docs/SECURITY.md §1, ~15 min) bounds how
 * stale that embedded grant set can get.
 */
export interface JwtPayload {
  /** User id. */
  sub: string;
  email: string;
  /** Name of the resolved Role for this session's tenant context, or null for a SuperAdmin session with no clinic. */
  role: string | null;
  /** Never trusted from client input — derived server-side at login/refresh, per docs/SECURITY.md §4. */
  clinicId: string | null;
  clinicName: string | null;
  isSuperAdmin: boolean;
  permissions: string[];
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}
