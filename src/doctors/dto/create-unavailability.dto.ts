import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

/** One-off block on a doctor's schedule (leave, ad-hoc unavailability) — Phase 5. */
export class CreateUnavailabilityDto {
  @ApiProperty({ description: 'UTC ISO instant' })
  @IsISO8601()
  startsAt!: string;

  @ApiProperty({ description: 'UTC ISO instant' })
  @IsISO8601()
  endsAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
