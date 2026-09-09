import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BILLING_INTERVALS, type BillingInterval } from './create-plan.dto';

const SORT_FIELDS = ['name', 'price', 'createdAt'] as const;
export type PlanSortField = (typeof SORT_FIELDS)[number];

const STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type PlanStatusFilter = (typeof STATUSES)[number];

/** Super Admin plan list — search/filter/sort/paginate (SA-06). */
export class QueryPlansDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search by name or description' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: PlanStatusFilter;

  @ApiPropertyOptional({ enum: BILLING_INTERVALS })
  @IsOptional()
  @IsIn(BILLING_INTERVALS)
  billingInterval?: BillingInterval;

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: PlanSortField = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
