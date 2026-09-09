import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'OTHER'] as const;

export class CreatePaymentDto {
  @ApiProperty()
  @IsUUID('4')
  invoiceId!: string;

  @ApiProperty({ description: 'Decimal(10,2) — must not exceed the invoice balance due' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  method!: (typeof PAYMENT_METHODS)[number];

  @ApiPropertyOptional({
    description: 'e.g. a UPI transaction ID or card reference staff types in',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
