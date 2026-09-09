import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateConsultationDto } from './create-consultation.dto';

/** All structured fields, all optional — status/appointmentId are never changed via this route. */
export class UpdateConsultationDto extends PartialType(
  OmitType(CreateConsultationDto, ['appointmentId'] as const),
) {}
