import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const SORT_FIELDS = ['utilization', 'clinicName'] as const;
export type UsageSortField = (typeof SORT_FIELDS)[number];

/** Super Admin usage overview — filter/sort/paginate (SA-09). */
export class QueryUsageDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search by clinic name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiPropertyOptional({ description: 'Only clinics over at least one plan limit' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  overLimitOnly?: boolean;

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'utilization' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: UsageSortField = 'utilization';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
