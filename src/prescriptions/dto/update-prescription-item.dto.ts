import { PartialType } from '@nestjs/swagger';
import { CreatePrescriptionItemDto } from './create-prescription-item.dto';

export class UpdatePrescriptionItemDto extends PartialType(CreatePrescriptionItemDto) {}
