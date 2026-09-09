export interface ConsultationAmendmentResponseDto {
  id: string;
  consultationId: string;
  amendedByUserId: string;
  reason: string;
  changedFields: string;
  /** Parsed JSON snapshot of only the changed fields' previous values. */
  previousValues: Record<string, unknown>;
  createdAt: Date;
}
