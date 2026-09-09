import { PartialType } from '@nestjs/swagger';
import { CreateMedicineDto } from './create-medicine.dto';

/** All fields optional, including `isActive` — the retire/reactivate toggle. */
export class UpdateMedicineDto extends PartialType(CreateMedicineDto) {}
