import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNumber, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreatePurchaseItemDto {
  @ApiProperty()
  @IsUUID('4')
  medicineId!: string;

  @ApiProperty({
    description:
      'Supplier/physical batch identifier. Restocking an existing batch (same medicine+branch+batchNumber) tops up its quantityOnHand instead of creating a new batch row.',
  })
  @IsString()
  @MaxLength(100)
  batchNumber!: string;

  @ApiProperty()
  @IsDateString()
  expiryDate!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ description: 'Decimal(10,2) — cost price per unit' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  purchasePrice!: number;

  @ApiProperty({ description: 'Decimal(10,2) — price per unit this batch will be dispensed at' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  sellingPrice!: number;
}
