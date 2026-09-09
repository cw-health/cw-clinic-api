import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const INVESTIGATION_PRIORITIES = ['ROUTINE', 'URGENT'] as const;
export type InvestigationPriority = (typeof INVESTIGATION_PRIORITIES)[number];

export class CreateInvestigationOrderDto {
  @ApiProperty({ description: 'e.g. "Complete Blood Count", "Chest X-Ray" — free text' })
  @IsString()
  @MaxLength(200)
  testName!: string;

  @ApiPropertyOptional({ description: 'e.g. "Lab", "Imaging", "Other" — free text' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @ApiPropertyOptional({ enum: INVESTIGATION_PRIORITIES, default: 'ROUTINE' })
  @IsOptional()
  @IsIn(INVESTIGATION_PRIORITIES)
  priority?: InvestigationPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  clinicalNotes?: string;
}
