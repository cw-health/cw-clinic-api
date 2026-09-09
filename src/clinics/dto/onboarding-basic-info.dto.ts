import { PickType } from '@nestjs/swagger';
import { UpdateClinicDto } from './update-clinic.dto';

/**
 * Onboarding wizard step 1 ("Hospital information") — a whitelisted subset
 * of `UpdateClinicDto` so this step can only ever write the fields it
 * actually owns, even though the underlying `updateOwnClinic` write path is
 * shared (see ClinicsService.applyOnboardingStepUpdate). `name`/`slug`
 * intentionally excluded — see UpdateClinicDto's own comment.
 */
export class OnboardingBasicInfoDto extends PickType(UpdateClinicDto, [
  'facilityType',
  'description',
  'contactEmail',
  'contactPhone',
  'alternatePhone',
  'website',
  'timezone',
  'currency',
  'defaultAppointmentDurationMinutes',
] as const) {}
