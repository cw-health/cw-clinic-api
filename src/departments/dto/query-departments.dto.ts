import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const SORT_FIELDS = ['name', 'code', 'createdAt'] as const;
export type DepartmentSortField = (typeof SORT_FIELDS)[number];

export class QueryDepartmentsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter to departments under one branch' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Search by name or code' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'ARCHIVED'])
  status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'name' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: DepartmentSortField = 'name';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'asc';
}
