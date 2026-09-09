import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class QueryPrescriptionsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: "A patient's prescription history" })
  @IsOptional()
  @IsUUID('4')
  patientId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  doctorId?: string;

  @ApiPropertyOptional({ description: 'The full version chain for one consultation' })
  @IsOptional()
  @IsUUID('4')
  consultationId?: string;
}
