import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** POST /queue/token — issues (or, idempotently, returns) today's queue token for a checked-in appointment. */
export class GenerateTokenDto {
  @ApiProperty()
  @IsUUID('4')
  appointmentId!: string;
}
