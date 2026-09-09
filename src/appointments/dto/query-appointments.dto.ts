import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'CHECKED_IN',
  'WAITING',
  'IN_CONSULTATION',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Why the appointment exists — set once at creation, see Appointment.type's doc comment in schema.prisma. */
export const APPOINTMENT_TYPES = ['WALK_IN', 'SCHEDULED', 'FOLLOW_UP'] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export class QueryAppointmentsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  doctorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  patientId?: string;

  @ApiPropertyOptional({ enum: APPOINTMENT_STATUSES })
  @IsOptional()
  @IsIn(APPOINTMENT_STATUSES)
  status?: AppointmentStatus;

  @ApiPropertyOptional({ enum: APPOINTMENT_TYPES })
  @IsOptional()
  @IsIn(APPOINTMENT_TYPES)
  type?: AppointmentType;

  @ApiPropertyOptional({ description: 'UTC ISO instant — inclusive lower bound on startsAt' })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'UTC ISO instant — exclusive upper bound on startsAt' })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Search by patient name/MRN or doctor name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
