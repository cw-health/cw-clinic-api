import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateHolidayDto {
  @ApiProperty({ example: '2026-12-25' })
  @IsDateString()
  date!: string;

  @ApiProperty({ example: 'Christmas Day' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}
