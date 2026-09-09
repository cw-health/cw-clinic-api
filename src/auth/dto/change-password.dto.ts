import { IsString, MinLength } from 'class-validator';
import { IsStrongPassword } from '../validators/strong-password.decorator';

/** Authenticated body for POST /auth/change-password. */
export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsStrongPassword()
  newPassword!: string;
}
