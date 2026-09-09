import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsUUID } from 'class-validator';

export class QueryAvailableSlotsDto {
  @ApiProperty()
  @IsUUID('4')
  doctorId!: string;

  @ApiProperty({ description: 'Clinic-local calendar date, YYYY-MM-DD', example: '2026-09-10' })
  @IsDateString({ strict: true })
  date!: string;
}
