import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Front-desk/admin patient registration. Deliberately narrow field set —
 * identifiers + contact info + minimal "basic history" only, no government
 * ID or structured clinical record (docs: "Do not collect unnecessary
 * sensitive information").
 *
 * `createPortalAccount` optionally provisions a login (User + userId link)
 * for mobile self-service, mirroring doctor onboarding — `email` and
 * `temporaryPassword` are then required.
 */
export class CreatePatientDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @ApiPropertyOptional({ enum: ['MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED'] })
  @IsOptional()
  @IsIn(['MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED'])
  gender?: string;

  @ApiPropertyOptional({ example: '1990-05-20' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional()
  @ValidateIf((dto: CreatePatientDto) => dto.createPortalAccount === true || !!dto.email)
  @IsEmail()
  email?: string;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  emergencyContactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  emergencyContactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  knownAllergies?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  chronicConditions?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  createPortalAccount?: boolean;

  @ApiPropertyOptional({ minLength: 8 })
  @ValidateIf((dto: CreatePatientDto) => dto.createPortalAccount === true)
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  temporaryPassword?: string;

  /**
   * Set only after the caller has reviewed the potential-duplicate matches
   * returned by `POST /patients/check-duplicates` (or by a prior 409 from
   * this same endpoint) and explicitly chosen to register anyway. Without
   * it, `create()`/`update()` reject a request whose phone/email/mrn/
   * name+dateOfBirth matches an existing patient in this clinic — see
   * PatientsService.checkDuplicates.
   */
  @ApiPropertyOptional({
    default: false,
    description:
      'Confirms the caller reviewed potential duplicate matches and wants to proceed anyway',
  })
  @IsOptional()
  @IsBoolean()
  confirmDuplicate?: boolean;
}
