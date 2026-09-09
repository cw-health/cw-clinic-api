import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TIMELINE_EVENT_TYPES, type TimelineEventType } from './patient-timeline-entry.dto';

export class QueryPatientTimelineDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Inclusive lower bound on occurredAt (UTC ISO instant)' })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Exclusive upper bound on occurredAt (UTC ISO instant)' })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional({
    enum: TIMELINE_EVENT_TYPES,
    description: 'Restrict to one event type; omit for the full unified timeline',
  })
  @IsOptional()
  @IsIn(TIMELINE_EVENT_TYPES)
  type?: TimelineEventType;
}
