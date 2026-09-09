import { ApiProperty, ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { CreateStaffDto } from './create-staff.dto';

/** Identity fields only — role/branch/department each have their own dedicated assignment endpoint (see StaffController). */
export class UpdateStaffDto extends PartialType(
  PickType(CreateStaffDto, ['firstName', 'lastName'] as const),
) {}

export class AssignStaffRoleDto {
  @ApiProperty({ description: 'One of the clinic-visible roles from GET /staff/roles' })
  @IsUUID()
  roleId!: string;
}

export class AssignStaffBranchDto {
  @ApiPropertyOptional({ description: 'null clears the assignment' })
  @IsOptional()
  @IsUUID()
  branchId?: string | null;
}

export class AssignStaffDepartmentDto {
  @ApiPropertyOptional({ description: 'null clears the assignment' })
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;
}

export class UpdateStaffStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsIn(['ACTIVE', 'INACTIVE'])
  status!: 'ACTIVE' | 'INACTIVE';
}
