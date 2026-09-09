import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class AvailabilityEntryDto {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0=Sunday .. 6=Saturday' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;

  @ApiProperty({ example: '09:00' })
  @IsString()
  @Matches(TIME_PATTERN, { message: 'startTime must be in HH:mm 24h format' })
  startTime!: string;

  @ApiProperty({ example: '17:00' })
  @IsString()
  @Matches(TIME_PATTERN, { message: 'endTime must be in HH:mm 24h format' })
  endTime!: string;
}

export class SetAvailabilityDto {
  @ApiProperty({ type: [AvailabilityEntryDto] })
  @ValidateNested({ each: true })
  @Type(() => AvailabilityEntryDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  days!: AvailabilityEntryDto[];
}
