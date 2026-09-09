import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * ClinicAdmin-driven custom role creation, scoped to the caller's own
 * clinic (docs/RBAC.md §2 — a custom `Role` with `clinicId` set and
 * `isSystem: false`). `permissionKeys` is validated against the seeded
 * `Permission` catalog in the service layer — a key that doesn't exist, or
 * belongs to a platform-only category (`clinics:*`, `super-admin:*`), is
 * rejected there (privilege-escalation guard), not merely by this DTO.
 */
export class CreateRoleDto {
  @ApiProperty({ description: 'Role name, unique within the clinic' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    type: [String],
    description: 'Permission keys to grant this role, e.g. "patients:read"',
  })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[a-z][a-z-]*:[a-z][a-z-]*$/, {
    each: true,
    message: 'each permission key must look like "category:action"',
  })
  permissionKeys!: string[];
}
