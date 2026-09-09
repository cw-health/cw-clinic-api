import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsInt, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class BreakEntryDto {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0=Sunday .. 6=Saturday' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @ApiProperty({ example: '13:00' })
  @IsString()
  @Matches(TIME_PATTERN, { message: 'startTime must be in HH:mm 24h format' })
  startTime!: string;

  @ApiProperty({ example: '14:00' })
  @IsString()
  @Matches(TIME_PATTERN, { message: 'endTime must be in HH:mm 24h format' })
  endTime!: string;
}

/** Full-replace payload, mirrors SetAvailabilityDto — multiple breaks/day allowed (e.g. lunch + afternoon). */
export class SetBreaksDto {
  @ApiProperty({ type: [BreakEntryDto] })
  @ValidateNested({ each: true })
  @Type(() => BreakEntryDto)
  @ArrayMaxSize(50)
  breaks!: BreakEntryDto[];
}
