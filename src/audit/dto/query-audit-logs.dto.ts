import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const SORT_FIELDS = ['createdAt'] as const;
export type AuditLogSortField = (typeof SORT_FIELDS)[number];

/** Super Admin audit-log read surface — search/filter/sort/paginate (SA-05). */
export class QueryAuditLogsDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search by entity/resource type, action, entity ID, or changed-fields summary',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by the acting user' })
  @IsOptional()
  @IsUUID('4')
  actorUserId?: string;

  @ApiPropertyOptional({ description: 'Filter by action (e.g. CREATE, UPDATE, invoice.issued)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({
    description: 'Filter by entity/resource type (e.g. Clinic, Invoice, User)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  entity?: string;

  @ApiPropertyOptional({ description: 'Filter by an exact resource/entity ID' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  entityId?: string;

  @ApiPropertyOptional({
    description:
      'Filter by clinic/tenant. Omit to include platform-level events (clinicId: null) too.',
  })
  @IsOptional()
  @IsUUID('4')
  clinicId?: string;

  @ApiPropertyOptional({
    description:
      "Filter by the acting user's current branch assignment (ClinicMembership.branchId at query time — AuditLog itself carries no branchId, since most audited resources aren't branch-scoped yet). Requires clinicId.",
  })
  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @ApiPropertyOptional({
    description:
      "Filter by the acting user's current department assignment (ClinicMembership.departmentId at query time — same caveat as branchId). Requires clinicId.",
  })
  @IsOptional()
  @IsUUID('4')
  departmentId?: string;

  @ApiPropertyOptional({ description: 'UTC ISO instant — inclusive lower bound on createdAt' })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'UTC ISO instant — exclusive upper bound on createdAt' })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: AuditLogSortField = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
