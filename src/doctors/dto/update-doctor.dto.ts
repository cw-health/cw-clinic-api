import { ApiProperty, PartialType, PickType } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { CreateDoctorDto } from './create-doctor.dto';

/** Admin update of a doctor's professional profile — everything except identity/login fields. */
export class UpdateDoctorDto extends PartialType(
  PickType(CreateDoctorDto, [
    'phone',
    'licenseNumber',
    'qualification',
    'bio',
    'consultationFee',
    'yearsOfExperience',
    'specializationIds',
    'departmentIds',
    'appointmentDurationMinutes',
  ] as const),
) {}

/** Doctor self-service update — a narrower field set than admin's UpdateDoctorDto (no fee/specialization/license changes). */
export class UpdateOwnDoctorDto extends PartialType(
  PickType(CreateDoctorDto, ['phone', 'qualification', 'bio'] as const),
) {}

export class UpdateDoctorStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsIn(['ACTIVE', 'INACTIVE'])
  status!: 'ACTIVE' | 'INACTIVE';
}
