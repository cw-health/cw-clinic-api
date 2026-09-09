import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const SORT_FIELDS = ['name', 'createdAt', 'mrn'] as const;
export type PatientSortField = (typeof SORT_FIELDS)[number];

export class QueryPatientsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search by name, phone, email, or MRN' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'ARCHIVED'])
  status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

  @ApiPropertyOptional({ enum: ['MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED'] })
  @IsOptional()
  @IsIn(['MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED'])
  gender?: string;

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'name' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: PatientSortField = 'name';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'asc';
}
