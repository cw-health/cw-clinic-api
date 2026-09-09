import { PickType } from '@nestjs/swagger';
import { UpdateClinicDto } from './update-clinic.dto';

/** Onboarding wizard step 3 ("Address") — see OnboardingBasicInfoDto's comment. */
export class OnboardingAddressDto extends PickType(UpdateClinicDto, [
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'postalCode',
  'country',
] as const) {}
