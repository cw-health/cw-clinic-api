import { OmitType, PartialType, PickType } from '@nestjs/swagger';
import { CreatePatientDto } from './create-patient.dto';

/** Admin/FrontDesk update — everything except portal-account provisioning, which only happens at registration. */
export class UpdatePatientDto extends PartialType(
  OmitType(CreatePatientDto, ['createPortalAccount', 'temporaryPassword'] as const),
) {}

/** Patient self-service update — contact/address/emergency-contact only, not identity or clinical fields. */
export class UpdateOwnPatientDto extends PartialType(
  PickType(CreatePatientDto, [
    'phone',
    'email',
    'addressLine1',
    'addressLine2',
    'city',
    'state',
    'postalCode',
    'country',
    'emergencyContactName',
    'emergencyContactPhone',
  ] as const),
) {}
