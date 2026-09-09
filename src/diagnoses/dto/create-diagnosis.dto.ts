import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const DIAGNOSIS_TYPES = ['PRIMARY', 'SECONDARY', 'DIFFERENTIAL'] as const;
export type DiagnosisType = (typeof DIAGNOSIS_TYPES)[number];

export class CreateDiagnosisDto {
  @ApiProperty({ enum: DIAGNOSIS_TYPES })
  @IsIn(DIAGNOSIS_TYPES)
  type!: DiagnosisType;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  description!: string;

  @ApiPropertyOptional({ description: 'Optional ICD-10/11 code — free text, not validated' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  icdCode?: string;
}
