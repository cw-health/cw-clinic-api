import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Super Admin platform-user edit (SA-04). Only identity fields are
 * editable here — no `status` (use the dedicated activate/deactivate
 * endpoints), no `password` (out of scope for this phase, no reset flow
 * exists yet), no `clinicId`/`isSuperAdmin`/`permissions`/`roleId`. The
 * global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`
 * rejects any extra client-supplied field outright.
 */
export class UpdatePlatformUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;
}
