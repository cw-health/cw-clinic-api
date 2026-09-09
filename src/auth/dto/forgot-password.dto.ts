import { IsEmail } from 'class-validator';

/** Public body for POST /auth/forgot-password. */
export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}
