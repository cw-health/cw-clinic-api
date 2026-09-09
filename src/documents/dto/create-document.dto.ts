import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const DOCUMENT_CATEGORIES = [
  'LAB_REPORT',
  'IMAGING',
  'REFERRAL_LETTER',
  'INSURANCE',
  'OTHER',
] as const;

export class CreateDocumentDto {
  @ApiProperty()
  @IsUUID('4')
  patientId!: string;

  @ApiProperty({ enum: DOCUMENT_CATEGORIES })
  @IsIn(DOCUMENT_CATEGORIES)
  category!: (typeof DOCUMENT_CATEGORIES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
