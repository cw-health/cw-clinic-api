import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const SORT_FIELDS = ['name', 'createdAt'] as const;
export type ClinicSortField = (typeof SORT_FIELDS)[number];

const STATUSES = ['ACTIVE', 'SUSPENDED', 'INACTIVE', 'ARCHIVED'] as const;
export type ClinicStatusFilter = (typeof STATUSES)[number];

const ONBOARDING_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'] as const;
export type ClinicOnboardingStatusFilter = (typeof ONBOARDING_STATUSES)[number];

/** Super Admin clinic-registry list — search/filter/sort/paginate (SA-03, extended SA-03.1). */
export class QueryClinicsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search by name, slug, or contact email' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: ClinicStatusFilter;

  @ApiPropertyOptional({ enum: ONBOARDING_STATUSES })
  @IsOptional()
  @IsIn(ONBOARDING_STATUSES)
  onboardingStatus?: ClinicOnboardingStatusFilter;

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: ClinicSortField = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
