import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { CreateBranchDto } from './create-branch.dto';

/** Full field set is editable post-creation — unlike Doctor, a branch has no identity/login fields carved out. */
export class UpdateBranchDto extends PartialType(CreateBranchDto) {}

export class UpdateBranchStatusDto {
  /**
   * ARCHIVED is deliberately excluded here — archiving is a one-way action
   * only reachable via POST /branches/:id/archive, mirroring Clinic's own
   * activate/suspend vs. archive split (docs/DECISIONS.md ADR-009).
   */
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsIn(['ACTIVE', 'INACTIVE'])
  status!: 'ACTIVE' | 'INACTIVE';
}
