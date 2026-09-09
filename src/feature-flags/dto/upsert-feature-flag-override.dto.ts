import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** Sets (creates or replaces) a clinic's override for a CLINIC-scope flag (SA-08). */
export class UpsertFeatureFlagOverrideDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}
