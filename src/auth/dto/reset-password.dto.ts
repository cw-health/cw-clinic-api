import { IsString } from 'class-validator';
import { IsStrongPassword } from '../validators/strong-password.decorator';

/** Public body for POST /auth/reset-password. */
export class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsStrongPassword()
  newPassword!: string;
}
