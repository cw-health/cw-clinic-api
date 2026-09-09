/**
 * Signed payload for the short-lived public document-content route —
 * exact mirror of billing/billing-download-token.interface.ts and
 * prescriptions/prescription-download-token.interface.ts, one purpose tag
 * for this document kind.
 */
export interface DocumentDownloadTokenPayload {
  purpose: 'document-content';
  id: string;
  clinicId: string;
}
