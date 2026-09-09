import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Manual ledger entry types — the four movement kinds a pharmacist enters
 * by hand. PURCHASE and DISPENSE are never created through this endpoint:
 * they're written only by PurchasesService/DispensingService as part of
 * their own flow, each already carrying a `referenceId` that this manual
 * path has no equivalent for.
 */
export const MANUAL_STOCK_MOVEMENT_TYPES = ['RETURN', 'ADJUSTMENT', 'EXPIRED', 'DAMAGED'] as const;

export const STOCK_MOVEMENT_DIRECTIONS = ['IN', 'OUT'] as const;

export class CreateStockMovementDto {
  @ApiProperty()
  @IsUUID('4')
  batchId!: string;

  @ApiProperty({ enum: MANUAL_STOCK_MOVEMENT_TYPES })
  @IsIn(MANUAL_STOCK_MOVEMENT_TYPES)
  type!: (typeof MANUAL_STOCK_MOVEMENT_TYPES)[number];

  @ApiProperty({
    enum: STOCK_MOVEMENT_DIRECTIONS,
    description: 'RETURN must be IN, EXPIRED/DAMAGED must be OUT; ADJUSTMENT may be either',
  })
  @IsIn(STOCK_MOVEMENT_DIRECTIONS)
  direction!: (typeof STOCK_MOVEMENT_DIRECTIONS)[number];

  @ApiProperty({ description: 'Positive count of units moved' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ description: 'Why this movement was made — required for every manual entry' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
