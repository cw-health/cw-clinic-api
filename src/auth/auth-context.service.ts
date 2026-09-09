import { ForbiddenException, Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ResolvedAuthContext {
  role: string | null;
  clinicId: string | null;
  clinicName: string | null;
  permissions: string[];
}

/**
 * Resolves a User's role/clinic/permissions for a session's tenant context
 * (docs/RBAC.md §1, §5). Never trusts a clinicId supplied by the client —
 * `preferredClinicId` is only ever passed back in from a value the server
 * itself issued earlier (a refresh token's pinned clinicId, or the current
 * access token's own claim), never from request input.
 */
@Injectable()
export class AuthContextService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(user: User, preferredClinicId?: string | null): Promise<ResolvedAuthContext> {
    if (user.isSuperAdmin) {
      const superAdminRole = await this.prisma.role.findFirst({
        where: { clinicId: null, name: 'SuperAdmin' },
        include: { rolePermissions: { include: { permission: true } } },
      });
      return {
        role: 'SuperAdmin',
        clinicId: null,
        clinicName: null,
        permissions: superAdminRole?.rolePermissions.map((rp) => rp.permission.key) ?? [],
      };
    }

    const membership = await this.prisma.clinicMembership.findFirst({
      where: {
        userId: user.id,
        status: 'ACTIVE',
        // Defense in depth alongside RolesService.archive's reassignment
        // flow (docs/RBAC.md §7): a membership pointing at an archived
        // (INACTIVE) Role resolves no permissions at all rather than
        // silently keeping its now-deactivated grant set.
        role: { status: 'ACTIVE' },
        ...(preferredClinicId ? { clinicId: preferredClinicId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      include: {
        clinic: true,
        role: { include: { rolePermissions: { include: { permission: true } } } },
      },
    });

    if (!membership) {
      throw new ForbiddenException('No active clinic membership for this account');
    }

    return {
      role: membership.role.name,
      clinicId: membership.clinicId,
      clinicName: membership.clinic.name,
      permissions: membership.role.rolePermissions.map((rp) => rp.permission.key),
    };
  }
}
