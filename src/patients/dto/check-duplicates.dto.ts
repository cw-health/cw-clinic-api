import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Params for duplicate-candidate lookup (PatientsService.checkDuplicates)
 * — used both by the standalone `POST /patients/check-duplicates` endpoint
 * (frontend pre-flight check during registration) and internally by
 * `create()`/`update()` to gate on `confirmDuplicate`. All fields are
 * optional at the DTO-validation layer; the service itself requires at
 * least one usable identifier (phone, email, mrn, or firstName+lastName+
 * dateOfBirth together) and treats an under-specified request as "no
 * matches" rather than erroring, since a partial registration form is a
 * normal, expected state while the user is still typing.
 */
export class CheckPatientDuplicatesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ example: '1990-05-20' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  mrn?: string;

  /** Excludes this patient id from the match set — used by `update()` so a patient never matches itself. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  excludePatientId?: string;
}
