import { NotFoundException } from '@nestjs/common';

/**
 * Tenant-isolation guard for update/delete-by-id (docs/SECURITY.md §4).
 *
 * The rest of this codebase's mutation methods follow a
 * "verify-then-write" shape: fetch the row scoped to `{ id, clinicId }` (or
 * to a parent row already verified that way), then hand the bare `id` to
 * `prisma.<model>.update`/`.delete`. That is safe *today* only because
 * every call site remembers to do the verify step first — a future call
 * site (a bulk endpoint, an internal service method, a copy-pasted
 * handler) that skips it silently reopens a cross-tenant write, since
 * `update`/`delete` accept any row id regardless of tenant.
 *
 * The fix is to make the tenant scope part of the write's own `where`
 * clause, not a separate check the caller must remember: use
 * `updateMany`/`deleteMany` with the scoping fields folded into `where`
 * (clinicId for a directly tenant-owned model, or a parent id already
 * verified to belong to the tenant for a child row with no clinicId column
 * of its own, e.g. PrescriptionItem/InvoiceItem), then call this helper on
 * the result. `count === 0` means either the row doesn't exist or it
 * belongs to a different tenant — both cases 404, never leaking which.
 */
export function assertScopedWrite(result: { count: number }, message: string): void {
  if (result.count !== 1) throw new NotFoundException(message);
}
