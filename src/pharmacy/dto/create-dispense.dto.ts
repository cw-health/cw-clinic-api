import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateDispenseItemDto } from './create-dispense-item.dto';

export class CreateDispenseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @ApiProperty()
  @IsUUID('4')
  patientId!: string;

  @ApiPropertyOptional({
    description:
      'A FINALIZED prescription this dispense fulfills. Omit for an over-the-counter/walk-in dispense.',
  })
  @IsOptional()
  @IsUUID('4')
  prescriptionId?: string;

  @ApiProperty({ type: [CreateDispenseItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateDispenseItemDto)
  items!: CreateDispenseItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
