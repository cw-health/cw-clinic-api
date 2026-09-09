import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Admin-driven doctor onboarding: creates the User (login identity),
 * ClinicMembership (Doctor role, this clinic), and Doctor profile in one
 * call. `temporaryPassword` is set directly by the admin — there is no
 * invite/email-reset flow in this phase; the doctor is expected to change
 * it after first login (out of scope: a password-change endpoint isn't
 * part of this phase either, tracked as a follow-up, not blocking).
 */
export class CreateDoctorDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  temporaryPassword!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  licenseNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  qualification?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  consultationFee?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 80 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(80)
  yearsOfExperience?: number;

  @ApiPropertyOptional({ type: [String], description: 'Specialization ids' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  specializationIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Department ids (Phase 1C) this doctor practices out of — each department carries its own ' +
      'branch, so this is how a doctor is associated with one or more branches. Every id must ' +
      'belong to this clinic.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  departmentIds?: string[];

  @ApiPropertyOptional({
    minimum: 5,
    maximum: 240,
    description:
      'Per-doctor appointment slot length override (minutes). Falls back to ' +
      "the clinic's defaultAppointmentDurationMinutes when unset (Phase 5).",
  })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(240)
  appointmentDurationMinutes?: number;
}
