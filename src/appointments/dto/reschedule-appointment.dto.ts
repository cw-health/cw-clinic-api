import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator';

export class RescheduleAppointmentDto {
  @ApiProperty({ description: 'UTC ISO instant' })
  @IsISO8601()
  startsAt!: string;

  @ApiProperty({ description: 'UTC ISO instant' })
  @IsISO8601()
  endsAt!: string;
}
