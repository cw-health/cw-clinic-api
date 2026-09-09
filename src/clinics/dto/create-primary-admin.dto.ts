import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * The tenant user who becomes this clinic's onboarding-designated primary
 * administrator — creates a `User` + `ClinicMembership` (`ClinicAdmin`
 * role), same shape as `CreateDoctorDto`'s admin-driven onboarding
 * (temporary password, no invite/email-reset flow yet). Never touches
 * `isSuperAdmin` — this is always a tenant user (docs/RBAC.md §6).
 *
 * No `phone` field: `User` has no phone column for any role today (only
 * `Doctor`'s own profile table does) — adding one would expand a shared
 * core model for every user type as a side effect of clinic onboarding,
 * out of scope here. Tracked as a follow-up, not silently worked around.
 */
export class CreatePrimaryAdminDto {
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
}
