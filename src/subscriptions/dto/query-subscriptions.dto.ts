import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

// SUPERSEDED deliberately excluded: it's a system-internal marker for a
// row replaced by a plan change, never a "current" status a filter should
// surface here — it only shows up in the per-clinic history endpoint.
const STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'] as const;
export type SubscriptionStatusFilter = (typeof STATUSES)[number];

const SORT_FIELDS = ['createdAt', 'currentPeriodEnd'] as const;
export type SubscriptionSortField = (typeof SORT_FIELDS)[number];

/**
 * Cross-clinic subscription list (SA-07) — every clinic's *current*
 * subscription (see `SubscriptionsService.listCurrentSubscriptions`), not
 * the full history. Filter by `planId`/`status` to find, e.g., every clinic
 * on a given plan or every clinic still on TRIAL.
 */
export class QuerySubscriptionsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: SubscriptionStatusFilter;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: SubscriptionSortField = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
