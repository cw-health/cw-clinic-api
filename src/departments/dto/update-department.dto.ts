import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { CreateDepartmentDto } from './create-department.dto';

/**
 * Full field set is editable post-creation, including `branchId` (moving a
 * department to a different branch of the same clinic) — mirrors Branch's
 * own "no identity/login fields carved out" convention. `doctorIds`, when
 * present, replaces the full assignment set (same semantics as
 * Doctor.specializationIds on UpdateDoctorDto).
 */
export class UpdateDepartmentDto extends PartialType(CreateDepartmentDto) {}

export class UpdateDepartmentStatusDto {
  /**
   * ARCHIVED is deliberately excluded here — archiving is a one-way action
   * only reachable via POST /departments/:id/archive, mirroring Branch's
   * own activate/deactivate vs. archive split.
   */
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsIn(['ACTIVE', 'INACTIVE'])
  status!: 'ACTIVE' | 'INACTIVE';
}
