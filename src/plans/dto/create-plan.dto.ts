import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export const BILLING_INTERVALS = ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/**
 * Super Admin plan creation (SA-06, docs/SUPER_ADMIN_ARCHITECTURE.md §6.5).
 * A plan is always created ACTIVE — lifecycle is managed only through the
 * activate/deactivate endpoints, never a status field here, mirroring
 * CreateClinicDto's precedent (status not settable at create).
 */
export class CreatePlanDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ description: 'Price per billing interval', minimum: 0 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ description: 'ISO 4217 currency code', default: 'INR' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency?: string;

  @ApiProperty({ enum: BILLING_INTERVALS })
  @IsIn(BILLING_INTERVALS)
  billingInterval!: BillingInterval;

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
    description: 'Feature keys granted by this plan',
  })
  @IsOptional()
  @IsIn(PLAN_FEATURE_KEYS, { each: true })
  @ArrayUnique()
  features?: PlanFeatureKey[];
}
