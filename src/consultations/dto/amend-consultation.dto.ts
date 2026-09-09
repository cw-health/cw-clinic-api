import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateConsultationDto } from './create-consultation.dto';

/**
 * Controlled amendment of a COMPLETED (locked) consultation
 * (docs/DATABASE.md §16) — same field set as UpdateConsultationDto plus a
 * required `reason`, distinct from an ordinary in-progress edit.
 */
export class AmendConsultationDto extends PartialType(
  OmitType(CreateConsultationDto, ['appointmentId'] as const),
) {
  @ApiProperty({ description: 'Why this completed consultation is being amended' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
