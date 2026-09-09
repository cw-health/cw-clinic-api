import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class RevenueSummaryQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export interface RevenueByMethod {
  method: string;
  totalCollected: string;
  paymentCount: number;
}

export interface RevenueSummaryResponseDto {
  totalInvoiced: string;
  totalCollected: string;
  totalRefunded: string;
  totalOutstanding: string;
  invoiceCount: number;
  paymentCount: number;
  byMethod: RevenueByMethod[];
}
