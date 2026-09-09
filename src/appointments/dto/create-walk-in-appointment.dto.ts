import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Front-desk registers a walk-in (POST /appointments/walk-in). No
 * `startsAt`/`endsAt` — a walk-in is "now" by definition, computed
 * server-side in AppointmentsService.createWalkIn(), never accepted from
 * the client (CLAUDE.md #3 in spirit).
 */
export class CreateWalkInAppointmentDto {
  @ApiProperty()
  @IsUUID('4')
  doctorId!: string;

  @ApiProperty()
  @IsUUID('4')
  patientId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonForVisit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
