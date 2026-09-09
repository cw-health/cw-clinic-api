import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsString, MaxLength, Min } from 'class-validator';

export class CreateRefundDto {
  @ApiProperty({ description: "Decimal(10,2) — must not exceed the payment's unrefunded balance" })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason!: string;
}
