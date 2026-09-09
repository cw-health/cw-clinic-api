/** Never includes storageKey — server-internal, never returned to a client. */
export interface ClinicDocumentResponseDto {
  id: string;
  clinicId: string;
  uploadedByUserId: string;
  category: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}
