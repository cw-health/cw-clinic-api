import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { FEATURE_FLAG_SCOPES, type FeatureFlagScope } from './create-feature-flag.dto';

/**
 * Edits a flag's descriptive metadata and supported scope (SA-08). `key`
 * and `enabled` are deliberately not editable here: `key` is the stable
 * identifier call sites depend on (immutable once created, same as
 * Plan.name-uniqueness precedent elsewhere), and `enabled` only changes
 * through the dedicated enable/disable endpoints so every toggle is
 * unambiguously auditable as ENABLE/DISABLE rather than a generic UPDATE.
 */
export class UpdateFeatureFlagDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    enum: FEATURE_FLAG_SCOPES,
    description:
      'Changing CLINIC -> GLOBAL does not delete existing clinic overrides, it just stops them being evaluated until the flag is promoted back to CLINIC scope.',
  })
  @IsOptional()
  @IsIn(FEATURE_FLAG_SCOPES)
  scope?: FeatureFlagScope;
}
