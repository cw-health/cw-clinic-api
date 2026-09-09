import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

// No `phone` field here: `User` (identity/auth) has none, and unlike
// Doctor there is no generic "StaffProfile" domain model to hold
// staff-specific contact info yet — adding one is out of scope for this
// phase (docs brief: "Staff-specific information should live in
// appropriate domain models" — Doctor already has phone for doctors; a
// non-doctor staff phone number waits on whatever domain model needs it).

/**
 * ClinicAdmin-driven staff invitation (Phase 1D — Staff Management):
 * creates the User (login identity, status PENDING) and ClinicMembership
 * (this clinic, the given role) in one call. There is no password field —
 * per the task brief ("do not send plaintext passwords"), the account is
 * activated through the invite-token/set-password flow
 * (UserInvitationsService, `POST /auth/accept-invite`), never a password
 * the admin types in on the staff member's behalf (contrast with
 * CreateDoctorDto.temporaryPassword, an earlier phase's narrower gap that
 * this phase does not retroactively fix — out of scope here).
 */
export class CreateStaffDto {
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

  @ApiProperty({
    description:
      "The Role to assign — one of the clinic-visible roles from GET /staff/roles. Never the platform's SuperAdmin role.",
  })
  @IsUUID()
  roleId!: string;

  @ApiPropertyOptional({ description: "One of the caller's own clinic's branches" })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: "One of the caller's own clinic's departments" })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
