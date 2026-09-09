import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class CreateDispenseItemDto {
  @ApiProperty()
  @IsUUID('4')
  medicineId!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({
    description: 'The prescribed line this dispenses, when dispensing against a prescription',
  })
  @IsOptional()
  @IsUUID('4')
  prescriptionItemId?: string;
}
