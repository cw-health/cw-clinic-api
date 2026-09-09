import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * The chargeable-service taxonomy (docs/DATABASE.md §18) — the single
 * source of truth every writer (this DTO's `IsIn`, admin/mobile's mirrored
 * unions) validates against. Widening this list is additive and never
 * touches a historical row: `CONSULTATION_FEE`/`PRESCRIPTION` (the old
 * vocabulary) stay readable on rows written before this change but are no
 * longer accepted here — see InvoiceResponseDto's `InvoiceItemType`.
 */
export const INVOICE_ITEM_TYPES = [
  'CONSULTATION',
  'PROCEDURE',
  'LABORATORY',
  'RADIOLOGY',
  'PHARMACY',
  'ROOM',
  'NURSING',
  'OTHER',
] as const;

export class CreateInvoiceItemDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  description!: string;

  @ApiPropertyOptional({ enum: INVOICE_ITEM_TYPES, default: 'OTHER' })
  @IsOptional()
  @IsIn(INVOICE_ITEM_TYPES)
  itemType?: (typeof INVOICE_ITEM_TYPES)[number];

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiProperty({ description: 'Decimal(10,2) — per-unit price before discount/tax' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice!: number;

  @ApiPropertyOptional({ description: 'Decimal(10,2), default 0' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountAmount?: number;

  @ApiPropertyOptional({ description: 'Decimal(5,2) percent, default 0', maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  taxRatePercent?: number;
}
