import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Staff books an appointment for a patient (POST /appointments). */
export class CreateAppointmentDto {
  @ApiProperty()
  @IsUUID('4')
  doctorId!: string;

  @ApiProperty()
  @IsUUID('4')
  patientId!: string;

  @ApiProperty({
    description:
      'UTC ISO instant — normally taken verbatim from a GET /appointments/available-slots entry',
  })
  @IsISO8601()
  startsAt!: string;

  @ApiProperty({ description: 'UTC ISO instant' })
  @IsISO8601()
  endsAt!: string;

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

  /**
   * Deliberately excludes WALK_IN — a walk-in is only ever created through
   * POST /appointments/walk-in (see CreateWalkInAppointmentDto), which
   * applies its own "is the doctor actually available right now" checks
   * that this pre-scheduled flow doesn't. Omitted defaults to SCHEDULED.
   */
  @ApiPropertyOptional({ enum: ['SCHEDULED', 'FOLLOW_UP'] })
  @IsOptional()
  @IsIn(['SCHEDULED', 'FOLLOW_UP'])
  type?: 'SCHEDULED' | 'FOLLOW_UP';
}

/**
 * Patient books their own appointment (POST /appointments/me). `patientId`
 * is deliberately absent here — it is resolved server-side from the
 * caller's own Patient record (mirrors PatientsService.findOwn), never
 * accepted from the body (CLAUDE.md #3 in spirit: never trust client input
 * for identity that must be derived from the authenticated session).
 * `type` is also absent — a patient's self-booking is always SCHEDULED,
 * hardcoded server-side in AppointmentsService.createOwn().
 */
export class CreateOwnAppointmentDto extends OmitType(CreateAppointmentDto, [
  'patientId',
  'type',
] as const) {}
