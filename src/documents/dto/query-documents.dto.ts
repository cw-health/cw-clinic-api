import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { DOCUMENT_CATEGORIES } from './create-document.dto';

export class QueryDocumentsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  patientId?: string;

  @ApiPropertyOptional({ enum: DOCUMENT_CATEGORIES })
  @IsOptional()
  @IsIn(DOCUMENT_CATEGORIES)
  category?: (typeof DOCUMENT_CATEGORIES)[number];
}

/** GET /documents/me — no patientId (always scoped to the caller's own patient record). */
export class QueryOwnDocumentsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DOCUMENT_CATEGORIES })
  @IsOptional()
  @IsIn(DOCUMENT_CATEGORIES)
  category?: (typeof DOCUMENT_CATEGORIES)[number];
}
