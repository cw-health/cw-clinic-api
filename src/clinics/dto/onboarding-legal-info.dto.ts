import { PickType } from '@nestjs/swagger';
import { UpdateClinicDto } from './update-clinic.dto';

/** Onboarding wizard step 2 ("Legal information") — see OnboardingBasicInfoDto's comment. */
export class OnboardingLegalInfoDto extends PickType(UpdateClinicDto, [
  'legalName',
  'legalEntityType',
  'registrationApplicable',
  'registrationNumber',
  'registrationAuthority',
  'registrationDate',
  'registrationExpiryDate',
  'taxIdentifierType',
  'taxIdentifierValue',
] as const) {}
