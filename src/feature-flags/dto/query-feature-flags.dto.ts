import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { FEATURE_FLAG_SCOPES, type FeatureFlagScope } from './create-feature-flag.dto';

const SORT_FIELDS = ['key', 'name', 'createdAt'] as const;
export type FeatureFlagSortField = (typeof SORT_FIELDS)[number];

/** Super Admin feature-flag list — search/filter/sort/paginate (SA-08). */
export class QueryFeatureFlagsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search by key, name or description' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: FEATURE_FLAG_SCOPES })
  @IsOptional()
  @IsIn(FEATURE_FLAG_SCOPES)
  scope?: FeatureFlagScope;

  @ApiPropertyOptional({ description: 'Filter by global default enabled state' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: FeatureFlagSortField = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
