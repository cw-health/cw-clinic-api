import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Denormalized display info for the acting user — never includes passwordHash or any credential (docs/SECURITY.md §9). `null` if the user row can no longer be resolved. */
export class AuditLogActorDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
}

/** Denormalized display info for the clinic — `null` for a platform-level event (`clinicId: null`) or if the clinic can no longer be resolved. */
export class AuditLogClinicDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

/**
 * Read shape for the Super Admin audit-log viewer (SA-05). Deliberately
 * carries only fields already on `AuditLog` (docs/DATABASE.md §9) plus
 * denormalized actor/clinic display info resolved server-side — never a
 * password/token/secret, since none of those are ever written to
 * `AuditLog.changedFields` by any existing caller (see AuditService's own
 * doc comment).
 */
export class AuditLogResponseDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true }) clinicId!: string | null;
  @ApiPropertyOptional({ type: AuditLogClinicDto, nullable: true })
  clinic!: AuditLogClinicDto | null;
  @ApiProperty() actorUserId!: string;
  @ApiPropertyOptional({ type: AuditLogActorDto, nullable: true }) actor!: AuditLogActorDto | null;
  @ApiProperty() actorType!: string;
  @ApiProperty() entity!: string;
  @ApiProperty() entityId!: string;
  @ApiProperty() action!: string;
  @ApiPropertyOptional({ nullable: true }) changedFields!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Correlation id for the originating request, where available.',
  })
  requestId!: string | null;
  @ApiPropertyOptional({ nullable: true }) ipAddress!: string | null;
  @ApiPropertyOptional({ nullable: true }) userAgent!: string | null;
  @ApiProperty() createdAt!: Date;
}
