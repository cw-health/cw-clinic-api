import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreatePrescriptionItemDto {
  @ApiProperty({ description: 'A formulary entry from the medicines catalog' })
  @IsUUID('4')
  medicineId!: string;

  @ApiProperty({ description: 'e.g. "500mg", "1 tablet"' })
  @IsString()
  @MaxLength(100)
  dosage!: string;

  @ApiProperty({ description: 'e.g. "twice daily", "every 8 hours"' })
  @IsString()
  @MaxLength(100)
  frequency!: string;

  @ApiProperty({ description: 'e.g. "5 days", "2 weeks"' })
  @IsString()
  @MaxLength(100)
  duration!: string;

  @ApiPropertyOptional({
    description: 'One of: ORAL, TOPICAL, INTRAVENOUS, INTRAMUSCULAR, SUBCUTANEOUS, INHALED, OTHER',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  route?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  instructions?: string;
}
