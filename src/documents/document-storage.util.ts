import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Upload validation allow-list (docs/SECURITY.md §7): exactly these MIME
 * types, each mapped to its conventional extension(s) for the "re-checked"
 * step below — declared mimetype's conventional extension must match the
 * uploaded filename's extension. No magic-byte sniffing (task brief: that's
 * overkill for this phase).
 */
export const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
};

export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MiB

export function isAllowedMimeType(mimeType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_MIME_TYPES, mimeType);
}

/** True if the filename's extension matches one of the declared mimetype's conventional extensions. */
export function extensionMatchesMimeType(fileName: string, mimeType: string): boolean {
  const allowedExtensions = ALLOWED_MIME_TYPES[mimeType];
  if (!allowedExtensions) return false;
  const ext = path.extname(fileName).toLowerCase();
  return allowedExtensions.includes(ext);
}

/**
 * Strips directory components and any residual ".." segments from a
 * client-supplied filename — never trust it as an on-disk path
 * (path-traversal). What's left is used only as the human-facing suffix of
 * the storage key, not the path itself (the path is namespaced by
 * clinicId + a fresh UUID — see buildStorageKey).
 */
export function sanitizeBasename(fileName: string): string {
  const base = path.basename(fileName).replace(/\.\./g, '');
  const cleaned = base.replace(/[/\\]/g, '').trim();
  return cleaned.length > 0 ? cleaned : 'file';
}

/** `${clinicId}/${randomUUID()}-${sanitizedOriginalBasename}` (task brief) — never derived from client input alone. */
export function buildStorageKey(clinicId: string, originalFileName: string): string {
  return path.posix.join(clinicId, `${randomUUID()}-${sanitizeBasename(originalFileName)}`);
}

/**
 * Same convention as `buildStorageKey`, namespaced under `clinic-documents/`
 * so clinic-registry documents (business/legal, Super Admin-managed) never
 * share a directory with patient documents (PHI, clinic-staff-managed) —
 * see ClinicDocument's doc comment (prisma/schema.prisma).
 */
export function buildClinicDocumentStorageKey(clinicId: string, originalFileName: string): string {
  return path.posix.join(
    'clinic-documents',
    clinicId,
    `${randomUUID()}-${sanitizeBasename(originalFileName)}`,
  );
}

/** Creates the storage root recursively if missing — never crashes the app at startup. */
export function ensureStorageDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
