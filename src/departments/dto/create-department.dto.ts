import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * ClinicAdmin-driven department creation — a new organizational unit under
 * one of the caller's own clinic's branches (e.g. "OPD", "Cardiology").
 * `branchId` must belong to the caller's clinic — checked in the service,
 * never trusted as-is (docs/SECURITY.md §4, same as every other
 * client-supplied foreign-key id).
 */
export class CreateDepartmentDto {
  @ApiProperty({ description: 'The branch this department belongs to' })
  @IsUUID()
  branchId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({
    description: 'Short human-facing code, unique within the branch (e.g. "OPD", "CARDIO")',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'code may only contain letters, digits, hyphens and underscores',
  })
  @MinLength(1)
  @MaxLength(20)
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Existing doctor ids (from the same clinic) to assign to this department',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  doctorIds?: string[];
}
