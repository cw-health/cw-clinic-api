import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import type { AuditLogResponseDto } from './dto/audit-log-response.dto';
import type { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

/** Allowed AuditLog.actorType values (see prisma/schema.prisma's AuditLog doc comment). */
export type AuditActorType = 'PLATFORM_USER' | 'TENANT_USER';

export interface RecordAuditEventInput {
  /**
   * The acting clinic for a tenant action. Omit (or pass null) for a
   * platform action (actorType: 'PLATFORM_USER') that has no single owning
   * clinic — e.g. a clinic being created. Never populate this from a
   * client-supplied field; callers derive it server-side from the
   * resolved tenant context (docs/SECURITY.md §4).
   */
  clinicId?: string | null;
  actorUserId: string;
  /**
   * Who performed the action. Defaults to 'TENANT_USER' for backwards
   * compatibility with every existing caller (billing, documents), which
   * are all clinic-scoped writes. A platform-level caller must pass
   * 'PLATFORM_USER' explicitly, determined server-side from the
   * authenticated user's `isSuperAdmin` flag — never accepted from the
   * client.
   */
  actorType?: AuditActorType;
  entity: string;
  entityId: string;
  action: string;
  /** Field names / short transition description only — never a full payload or PII/PHI (docs/SECURITY.md §8). */
  changedFields?: string;
  /** RequestIdMiddleware's X-Request-Id — correlates this row back to the originating request's log lines. Omit for cron/system-triggered writes that have no request. */
  requestId?: string;
  /** Caller's network address, where available (an HTTP request, not a cron/system trigger). */
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Write path for docs/DATABASE.md §9's AuditLog — one place per write path
 * (services call this directly after the write it audits), not scattered
 * ad hoc. Append-only: no update/delete method exists on this service, and
 * none should be added. `query()` below is the Super Admin audit-log
 * viewer's read surface (SA-05) — it only ever reads.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditEventInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: { ...input, actorType: input.actorType ?? 'TENANT_USER' },
      });
    } catch (error) {
      // An audit-write failure must never fail the business transaction it
      // describes (e.g. a payment that already succeeded) — log and move on.
      this.logger.error(
        `Failed to record audit event ${input.entity}:${input.action}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  /**
   * Super Admin audit-log investigation surface (SA-05). Read-only: builds
   * a filtered/paginated page over `AuditLog`, then resolves `actorUserId`/
   * `clinicId` to display info in two batched follow-up queries (no Prisma
   * relation exists on either denormalized FK column — see the model's own
   * doc comment — so this is a manual, explicit join, not a hidden N+1).
   * Every Prisma read here selects only display-safe fields; `User.
   * passwordHash` is never selected (docs/SECURITY.md §9).
   */
  async query(query: QueryAuditLogsDto): Promise<PaginatedResult<AuditLogResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    // AuditLog carries no branchId/departmentId of its own (most audited
    // resources — Patient, Appointment, etc. — aren't branch-scoped yet,
    // see the model's doc comment). A branch/department filter is
    // therefore answered via the *acting user's current* ClinicMembership
    // assignment for this clinic, not a property of the historical event
    // itself — a best-effort "who was on this branch/department" narrowing,
    // not a claim that the action happened there.
    let actorIdsForBranchOrDept: string[] | undefined;
    if (query.branchId || query.departmentId) {
      const memberships = await this.prisma.clinicMembership.findMany({
        where: {
          ...(query.clinicId ? { clinicId: query.clinicId } : {}),
          ...(query.branchId ? { branchId: query.branchId } : {}),
          ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        },
        select: { userId: true },
      });
      actorIdsForBranchOrDept = memberships.map((m) => m.userId);
    }

    const where: Prisma.AuditLogWhereInput = {
      ...(query.clinicId ? { clinicId: query.clinicId } : {}),
      // An explicit actorUserId is the more specific filter and wins over
      // the branch/department-derived actor list when both are given.
      ...(actorIdsForBranchOrDept ? { actorUserId: { in: actorIdsForBranchOrDept } } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lt: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { entity: { contains: query.search } },
              { action: { contains: query.search } },
              { entityId: { contains: query.search } },
              { changedFields: { contains: query.search } },
            ],
          }
        : {}),
    };

    const sortOrder = query.sortOrder ?? 'desc';

    const [total, logs] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const actorIds = [...new Set(logs.map((log) => log.actorUserId))];
    const clinicIds = [
      ...new Set(logs.map((log) => log.clinicId).filter((id): id is string => id != null)),
    ];

    const [actors, clinics] = await Promise.all([
      actorIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, firstName: true, lastName: true, email: true },
          })
        : Promise.resolve([]),
      clinicIds.length
        ? this.prisma.clinic.findMany({
            where: { id: { in: clinicIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const actorById = new Map(actors.map((actor) => [actor.id, actor]));
    const clinicById = new Map(clinics.map((clinic) => [clinic.id, clinic]));

    const data: AuditLogResponseDto[] = logs.map((log) => {
      const actor = actorById.get(log.actorUserId);
      const clinic = log.clinicId ? clinicById.get(log.clinicId) : undefined;
      return {
        id: log.id,
        clinicId: log.clinicId,
        clinic: clinic ? { id: clinic.id, name: clinic.name } : null,
        actorUserId: log.actorUserId,
        actor: actor
          ? { id: actor.id, name: `${actor.firstName} ${actor.lastName}`, email: actor.email }
          : null,
        actorType: log.actorType,
        entity: log.entity,
        entityId: log.entityId,
        action: log.action,
        changedFields: log.changedFields,
        requestId: log.requestId,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        createdAt: log.createdAt,
      };
    });

    return { data, meta: { total, page, pageSize } };
  }
}
