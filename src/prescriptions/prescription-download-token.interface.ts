/**
 * Claims for the short-lived, single-purpose token minted by
 * `POST /prescriptions/:id/download-token` and verified by the public
 * `GET /prescriptions/:id/pdf?token=...` route. Deliberately narrow (one
 * prescription id, one purpose, a short `expiresIn`) rather than accepting
 * the caller's normal access token on a public route — this way the public
 * PDF route can never be used as a general-purpose authenticated endpoint,
 * and a leaked/logged download URL self-expires quickly.
 */
export interface PrescriptionDownloadTokenPayload {
  purpose: 'prescription-pdf';
  prescriptionId: string;
  clinicId: string;
}
