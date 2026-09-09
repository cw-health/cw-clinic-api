import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export const FEATURE_FLAG_SCOPES = ['GLOBAL', 'CLINIC'] as const;
export type FeatureFlagScope = (typeof FEATURE_FLAG_SCOPES)[number];

/**
 * Super Admin feature-flag creation (SA-08,
 * docs/SUPER_ADMIN_ARCHITECTURE.md §6.7). A flag is always created with
 * its global `enabled` default — lifecycle toggling happens only through
 * the enable/disable endpoints afterwards, mirroring CreatePlanDto's
 * precedent (status/enabled not freely settable outside dedicated
 * endpoints where a dedicated endpoint exists).
 */
export class CreateFeatureFlagDto {
  @ApiProperty({
    description: 'Stable machine key call sites check against, e.g. "new-billing-ui"',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'key must be lowercase kebab-case, e.g. "new-billing-ui"',
  })
  key!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ default: false, description: 'Global default state' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    enum: FEATURE_FLAG_SCOPES,
    default: 'GLOBAL',
    description:
      'GLOBAL: evaluated the same for every clinic. CLINIC: a per-clinic override may be configured.',
  })
  @IsOptional()
  @IsIn(FEATURE_FLAG_SCOPES)
  scope?: FeatureFlagScope;
}
