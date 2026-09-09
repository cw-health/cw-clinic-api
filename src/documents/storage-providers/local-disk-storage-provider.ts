import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { AppConfig } from '../../config/configuration';
import { ensureStorageDir } from '../document-storage.util';
import type { DocumentStorageProvider } from './document-storage-provider.interface';

/**
 * Default DocumentStorageProvider (docs/DECISIONS.md ADR-008) — the local
 * disk, outside the public webroot (docs/SECURITY.md §9). Behavior-
 * preserving extraction of what documents.service.ts did inline before
 * Phase 8.
 */
@Injectable()
export class LocalDiskStorageProvider implements DocumentStorageProvider, OnModuleInit {
  private readonly storageDir: string;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.storageDir = configService.get('documentsStorageDir', { infer: true });
  }

  /** Ensures the storage root exists at startup rather than crashing on the first upload. */
  onModuleInit(): void {
    ensureStorageDir(this.storageDir);
  }

  async save(storageKey: string, buffer: Buffer): Promise<void> {
    const destination = path.join(this.storageDir, storageKey);
    // The clinicId-namespaced subdirectory may not exist yet for a clinic's
    // first upload — onModuleInit only creates the root.
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, buffer);
  }

  read(storageKey: string): Promise<Readable> {
    return Promise.resolve(createReadStream(path.join(this.storageDir, storageKey)));
  }

  async delete(storageKey: string): Promise<void> {
    await unlink(path.join(this.storageDir, storageKey)).catch(() => undefined);
  }
}
