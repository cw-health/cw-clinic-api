export type DocumentCategory = 'LAB_REPORT' | 'IMAGING' | 'REFERRAL_LETTER' | 'INSURANCE' | 'OTHER';

/**
 * Metadata only — `storageKey` (the server-internal on-disk path) is never
 * included here (docs/SECURITY.md §9).
 */
export interface DocumentResponseDto {
  id: string;
  clinicId: string;
  patientId: string;
  patientName: string;
  category: DocumentCategory;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  notes: string | null;
  uploadedByUserId: string;
  createdAt: Date;
}
