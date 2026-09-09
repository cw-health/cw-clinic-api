import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Partial update of a clinic's own custom role — rename, re-describe, and/or replace its permission set. System role templates never accept this (rejected in the service). */
export class UpdateRoleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[a-z][a-z-]*:[a-z][a-z-]*$/, {
    each: true,
    message: 'each permission key must look like "category:action"',
  })
  permissionKeys?: string[];
}

/**
 * Archiving (deactivating) a custom role that still has active staff on it
 * needs somewhere to move them first — `reassignToRoleId` does that
 * reassignment and the archive in one transaction. Omit it when the role
 * has no active assignments; the service rejects an omitted value when
 * there are some (docs brief: "prevent deleting a role that is still
 * actively assigned unless a safe reassignment flow exists").
 */
export class ArchiveRoleDto {
  @ApiPropertyOptional({
    description: 'Role id to move any actively-assigned staff to before archiving this one',
  })
  @IsOptional()
  @IsUUID()
  reassignToRoleId?: string;
}
