import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class QueryRolesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search by role name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional({
    enum: ['system', 'custom'],
    description:
      "Filter to only platform system-role templates, or only this clinic's own custom roles",
  })
  @IsOptional()
  @IsIn(['system', 'custom'])
  type?: 'system' | 'custom';
}
