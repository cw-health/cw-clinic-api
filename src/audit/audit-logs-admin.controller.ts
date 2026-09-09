import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { AuditService } from './audit.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

/**
 * Super Admin audit-log read surface (SA-05) — new controller in the
 * existing `audit` module, reusing `AuditService`'s single write path and
 * its Prisma access rather than a second audit table/service, per
 * docs/SUPER_ADMIN_ARCHITECTURE.md §6.11. Deliberately GET-only: no
 * POST/PATCH/DELETE route exists here, matching `AuditService`'s own
 * append-only contract — audit history is never editable from this
 * surface, including for a Super Admin.
 */
@ApiTags('super-admin-audit-logs')
@ApiBearerAuth()
@Controller({ path: 'super-admin/audit-logs', version: '1' })
export class AuditLogsAdminController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermissions('super-admin:audit-logs-read')
  async list(@Query() query: QueryAuditLogsDto) {
    return this.auditService.query(query);
  }
}
