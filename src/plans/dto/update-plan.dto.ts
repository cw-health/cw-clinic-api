import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PLAN_FEATURE_KEYS, type PlanFeatureKey } from '../plan-feature-keys';
import { BILLING_INTERVALS, type BillingInterval } from './create-plan.dto';

/**
 * Super Admin plan edit (SA-06) — every field optional, same "hand-rolled
 * partial" convention as AdminUpdateClinicDto rather than PartialType.
 * `status` is intentionally absent — lifecycle is managed only through the
 * activate/deactivate endpoints (docs/SUPER_ADMIN_ARCHITECTURE.md §6.5).
 * Passing `features` replaces the plan's full feature set (same "full
 * replace" convention as ClinicsService.setWorkingHours), not a merge.
 */
export class UpdatePlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ description: 'ISO 4217 currency code' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ enum: BILLING_INTERVALS })
  @IsOptional()
  @IsIn(BILLING_INTERVALS)
  billingInterval?: BillingInterval;

  @ApiPropertyOptional({ description: 'Maximum doctors. Omit for unlimited.', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxDoctors?: number;

  @ApiPropertyOptional({ description: 'Maximum staff. Omit for unlimited.', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxStaff?: number;

  @ApiPropertyOptional({ description: 'Maximum patients. Omit for unlimited.', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPatients?: number;

  @ApiPropertyOptional({ description: 'Maximum branches/clinics. Omit for unlimited.', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxBranches?: number;

  @ApiPropertyOptional({
    description: 'Trial length in days. Omit for no trial.',
    minimum: 0,
    maximum: 365,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  trialDays?: number;

  @ApiPropertyOptional({
    enum: PLAN_FEATURE_KEYS,
    isArray: true,
    description: 'Replaces the full feature set',
  })
  @IsOptional()
  @IsIn(PLAN_FEATURE_KEYS, { each: true })
  @ArrayUnique()
  features?: PlanFeatureKey[];
}
