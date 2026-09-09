/**
 * Signed payload for the short-lived public PDF routes (invoice PDF,
 * payment receipt PDF) — exact mirror of
 * prescriptions/prescription-download-token.interface.ts, one shared shape
 * for both document kinds via `purpose`.
 */
export interface BillingDownloadTokenPayload {
  purpose: 'invoice-pdf' | 'receipt-pdf';
  id: string;
  clinicId: string;
}
