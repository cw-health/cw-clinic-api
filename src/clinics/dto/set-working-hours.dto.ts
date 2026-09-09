import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class WorkingHoursEntryDto {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0=Sunday .. 6=Saturday' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @ApiProperty()
  @IsBoolean()
  isOpen!: boolean;

  @ApiProperty({ required: false, example: '09:00' })
  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN, { message: 'openTime must be in HH:mm 24h format' })
  openTime?: string;

  @ApiProperty({ required: false, example: '17:00' })
  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN, { message: 'closeTime must be in HH:mm 24h format' })
  closeTime?: string;
}

/** Replaces the clinic's full weekly schedule in one call — one entry per day, at most one per dayOfWeek. */
export class SetWorkingHoursDto {
  @ApiProperty({ type: [WorkingHoursEntryDto] })
  @ValidateNested({ each: true })
  @Type(() => WorkingHoursEntryDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  days!: WorkingHoursEntryDto[];
}
