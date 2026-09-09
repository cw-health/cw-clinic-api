import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const SORT_FIELDS = ['name', 'createdAt'] as const;
export type PlatformUserSortField = (typeof SORT_FIELDS)[number];

const STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING'] as const;
export type PlatformUserStatusFilter = (typeof STATUSES)[number];

/** Super Admin platform-user list — search/filter/sort/paginate (SA-04). */
export class QueryPlatformUsersDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search by first name, last name, or email' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: PlatformUserStatusFilter;

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: PlatformUserSortField = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
