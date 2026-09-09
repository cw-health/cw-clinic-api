import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { FACILITY_TYPES, type FacilityType } from './facility-type';
import { LEGAL_ENTITY_TYPES, type LegalEntityType } from './legal-entity-type';
import { CreatePrimaryAdminDto } from './create-primary-admin.dto';

/**
 * Super Admin tenant provisioning (SA-03, docs/SUPER_ADMIN_ARCHITECTURE.md
 * §6.2, extended SA-03.1 for onboarding). Creates the `Clinic` registry row
 * and, optionally, its primary administrator in one call — see
 * ClinicsService.createClinic. `name`/`slug` are the tenant-registry
 * identity, editable only through this Super Admin surface (see
 * UpdateClinicDto's own comment: ClinicAdmin's self-service PATCH
 * intentionally excludes them).
 */
export class CreateClinicDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ description: 'URL-safe unique identifier, e.g. "riverside-clinic"' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase letters, numbers, and hyphens only',
  })
  slug!: string;

  @ApiPropertyOptional({
    enum: FACILITY_TYPES,
    description: 'What kind of care facility this is',
  })
  @IsOptional()
  @IsIn(FACILITY_TYPES)
  facilityType?: FacilityType;

  @ApiPropertyOptional({ description: 'Registered/legal business name, if different from name' })
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
  @ApiPropertyOptional({
    default: true,
    description: 'False if no formal registration applies to this clinic',
  })
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
  @ApiPropertyOptional({ default: 'UTC' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  timezone?: string;

  @ApiPropertyOptional({ default: 'INR', description: 'ISO 4217 currency code' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ default: 15 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(240)
  defaultAppointmentDurationMinutes?: number;

  @ApiPropertyOptional({
    type: CreatePrimaryAdminDto,
    description:
      "Creates the clinic's primary administrator in the same call. Omit to create the clinic first and assign one later via POST /super-admin/clinics/:id/primary-admin.",
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreatePrimaryAdminDto)
  primaryAdmin?: CreatePrimaryAdminDto;
}
