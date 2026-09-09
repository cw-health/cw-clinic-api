import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class QueryConsultationsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Previous consultations for a patient (the history view)' })
  @IsOptional()
  @IsUUID('4')
  patientId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  doctorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  appointmentId?: string;
}
