import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID'] as const;

export class QueryInvoicesDto extends PaginationQueryDto {
  @ApiPropertyOptional()
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
  consultationId?: string;

  @ApiPropertyOptional({ enum: INVOICE_STATUSES })
  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: (typeof INVOICE_STATUSES)[number];

  @ApiPropertyOptional({ description: 'ISSUED or PARTIALLY_PAID (has an outstanding balance)' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  pendingOnly?: boolean;
}
