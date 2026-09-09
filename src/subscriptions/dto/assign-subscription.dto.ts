import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/**
 * Super Admin assigning a clinic's first subscription (SA-07,
 * docs/SUPER_ADMIN_ARCHITECTURE.md §6.6). No payment gateway exists yet
 * (matches the brief and `ManualPaymentProvider` precedent) — billing
 * status/period is recorded directly by the Super Admin, not derived from a
 * webhook. `currentPeriodEnd` is optional: when omitted, `SubscriptionsService`
 * derives it from the plan's own `billingInterval` (one less date the admin
 * has to compute by hand for the common case).
 */
export class AssignSubscriptionDto {
  @ApiProperty()
  @IsUUID()
  planId!: string;

  @ApiPropertyOptional({ description: 'Defaults to now' })
  @IsOptional()
  @IsDateString()
  currentPeriodStart?: string;

  @ApiPropertyOptional({
    description: "Defaults to currentPeriodStart + the plan's billingInterval",
  })
  @IsOptional()
  @IsDateString()
  currentPeriodEnd?: string;
}
