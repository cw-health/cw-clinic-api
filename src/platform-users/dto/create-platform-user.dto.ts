import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Super Admin platform-user provisioning (SA-04). Deliberately narrow: no
 * `clinicId`, no `isSuperAdmin`, no `permissions`/`roleId` — the server
 * always creates a platform identity (`isSuperAdmin: true`, no
 * ClinicMembership) and always assigns the existing `SuperAdmin` system
 * role, per docs/SUPER_ADMIN_ARCHITECTURE.md §6.4. The global
 * `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` in
 * main.ts rejects any extra client-supplied field outright.
 */
export class CreatePlatformUserDto {
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

  @ApiProperty()
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({ description: 'Initial password, set by the creating Super Admin' })
  @IsString()
  @MinLength(12)
  @MaxLength(200)
  password!: string;
}
