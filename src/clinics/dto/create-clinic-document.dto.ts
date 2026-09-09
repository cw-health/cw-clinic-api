import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const CLINIC_DOCUMENT_CATEGORIES = ['REGISTRATION_CERTIFICATE', 'LICENSE', 'OTHER'] as const;
export type ClinicDocumentCategory = (typeof CLINIC_DOCUMENT_CATEGORIES)[number];

/** Multipart form fields alongside the uploaded file (SA-03.1) — mirrors CreateDocumentDto's shape. */
export class CreateClinicDocumentDto {
  @ApiProperty({ enum: CLINIC_DOCUMENT_CATEGORIES })
  @IsIn(CLINIC_DOCUMENT_CATEGORIES)
  category!: ClinicDocumentCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
