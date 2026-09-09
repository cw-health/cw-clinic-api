import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateMedicineDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  genericName?: string;

  @ApiPropertyOptional({ description: 'Free text, e.g. "500mg", "5ml"' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  strength?: string;

  @ApiPropertyOptional({
    description: 'One of: TABLET, CAPSULE, SYRUP, INJECTION, OINTMENT, DROPS, INHALER, OTHER',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  form?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  manufacturer?: string;

  @ApiPropertyOptional({ description: 'Internal SKU/stock code, unique within the clinic' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  sku?: string;

  @ApiPropertyOptional({
    description:
      'Stock/dispensing unit, e.g. "TABLET", "BOTTLE", "STRIP", "VIAL" — distinct from `form`',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
