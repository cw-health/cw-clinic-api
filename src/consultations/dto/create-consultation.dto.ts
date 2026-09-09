import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Structured consultation fields (plan: "do not create only one giant notes
 * field"). All clinical fields beyond chiefComplaint are optional — a
 * doctor fills the form incrementally, not all at once (PATCH afterwards).
 */
export class CreateConsultationDto {
  @ApiProperty({ description: 'The appointment this consultation belongs to' })
  @IsUUID('4')
  appointmentId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  chiefComplaint!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  symptoms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  history?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  heightCm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  weightKg?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  temperatureCelsius?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  pulseBpm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  bloodPressureSystolic?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  bloodPressureDiastolic?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  respiratoryRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  spo2Percent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  examination?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  diagnosis?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  investigations?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  treatment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  advice?: string;

  @ApiPropertyOptional({ description: 'ISO date (no time) — YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  followUpDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  followUpInstructions?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    description:
      'Specialty-specific template identifier (extensibility hook, no template engine yet)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  templateKey?: string;

  @ApiPropertyOptional({ description: 'JSON-encoded specialty-specific structured extras' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  customFields?: string;
}
