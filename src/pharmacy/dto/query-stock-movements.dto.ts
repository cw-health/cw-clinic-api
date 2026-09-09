import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const STOCK_MOVEMENT_TYPES = [
  'PURCHASE',
  'DISPENSE',
  'RETURN',
  'ADJUSTMENT',
  'EXPIRED',
  'DAMAGED',
] as const;

export class QueryStockMovementsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  medicineId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  batchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @ApiPropertyOptional({ enum: STOCK_MOVEMENT_TYPES })
  @IsOptional()
  @IsIn(STOCK_MOVEMENT_TYPES)
  type?: (typeof STOCK_MOVEMENT_TYPES)[number];
}
