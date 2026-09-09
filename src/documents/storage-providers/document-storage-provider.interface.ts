import type { Readable } from 'node:stream';

/**
 * Abstraction over "where document bytes physically live" (docs/DECISIONS.md
 * ADR-008), mirroring PaymentProvider (billing/payment-providers).
 * DocumentsService depends only on this interface via the
 * DOCUMENT_STORAGE_PROVIDER token (documents.module.ts, STORAGE_DRIVER
 * config-selected) — access control (tenant/ownership checks, the
 * short-lived signed-download-token route) never changes with the driver,
 * only where `save`/`read`/`delete` land.
 */
export interface DocumentStorageProvider {
  save(storageKey: string, buffer: Buffer): Promise<void>;
  read(storageKey: string): Promise<Readable>;
  delete(storageKey: string): Promise<void>;
}

export const DOCUMENT_STORAGE_PROVIDER = Symbol('DOCUMENT_STORAGE_PROVIDER');
