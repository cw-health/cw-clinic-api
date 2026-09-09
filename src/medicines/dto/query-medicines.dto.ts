import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class QueryMedicinesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches against name or genericName' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  // Query strings arrive as text — `Type(() => Boolean)` would coerce the
  // literal string "false" to `true` (any non-empty string is truthy), so
  // this parses the two accepted literal values explicitly instead.
  @ApiPropertyOptional({ description: 'Filter to active-only or inactive-only entries' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isActive?: boolean;
}
