import { IsString, MaxLength, MinLength } from 'class-validator';

/** Public route body for POST /auth/accept-invite — sets a staff member's own password from an invite token (see UserInvitationsService). */
export class AcceptInviteDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}
