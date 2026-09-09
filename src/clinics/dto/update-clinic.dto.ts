import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { FACILITY_TYPES, type FacilityType } from './facility-type';
import { LEGAL_ENTITY_TYPES, type LegalEntityType } from './legal-entity-type';

/**
 * Clinic profile/legal/contact/address/settings — all PATCHable together
 * via PATCH /clinics/me (docs: "Admin can manage: clinic profile, legal
 * information, contact information, address, ..., clinic settings"), and
 * the same shape the onboarding wizard's per-step endpoints
 * (POST /clinics/me/onboarding/...) write through. `name`/`slug` are the
 * tenant-registry identity (SuperAdmin's `clinics:*`, out of scope here) —
 * intentionally not editable through this ClinicAdmin-facing endpoint, same
 * as `AdminUpdateClinicDto`'s own comment explains for the mirror-image
 * reason (only the identity fields differ between the two DTOs).
 */
export class UpdateClinicDto {
  @ApiPropertyOptional({
    enum: FACILITY_TYPES,
    description: 'What kind of care facility this is',
  })
  @IsOptional()
  @IsIn(FACILITY_TYPES)
  facilityType?: FacilityType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @ApiPropertyOptional({ enum: LEGAL_ENTITY_TYPES })
  @IsOptional()
  @IsIn(LEGAL_ENTITY_TYPES)
  legalEntityType?: LegalEntityType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  // Legal / registration profile
  @ApiPropertyOptional({ description: 'False if no formal registration applies to this clinic' })
  @IsOptional()
  @IsBoolean()
  registrationApplicable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  registrationNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  registrationAuthority?: string;

  @ApiPropertyOptional({ example: '2020-01-15' })
  @IsOptional()
  @IsDateString()
  registrationDate?: string;

  @ApiPropertyOptional({ example: '2030-01-15' })
  @IsOptional()
  @IsDateString()
  registrationExpiryDate?: string;

  @ApiPropertyOptional({ description: 'e.g. "GST", "VAT", "EIN" — not a fixed jurisdiction' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  taxIdentifierType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  taxIdentifierValue?: string;

  // Contact information
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  alternatePhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  website?: string;

  // Address
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  // Settings
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  timezone?: string;

  @ApiPropertyOptional({ description: 'ISO 4217 currency code' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(240)
  defaultAppointmentDurationMinutes?: number;
}
