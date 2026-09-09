import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Readable } from 'node:stream';
import type { AppConfig } from '../../config/configuration';
import type { DocumentStorageProvider } from './document-storage-provider.interface';

/**
 * Object-storage DocumentStorageProvider (docs/DECISIONS.md ADR-008),
 * selected via STORAGE_DRIVER=s3. Any S3-compatible bucket (AWS S3, or a
 * compatible endpoint via S3_ENDPOINT) — always a private bucket, no
 * public-read ACL: access control stays the signed-download-token route in
 * DocumentsService, never a bucket URL (docs/SECURITY.md §9).
 *
 * The S3Client is constructed lazily (not in the constructor): both storage
 * providers are registered as DI providers regardless of which one
 * STORAGE_DRIVER actually selects (documents.module.ts), and the S3 SDK
 * throws immediately if no region is configured — which must not break app
 * bootstrap in every environment that leaves S3_REGION empty and simply
 * doesn't use this provider (mirrors FcmNotificationProvider's lazy init).
 */
@Injectable()
export class S3StorageProvider implements DocumentStorageProvider {
  private client: S3Client | undefined;
  private readonly bucket: string;
  private readonly region: string;
  private readonly endpoint: string | undefined;

  constructor(configService: ConfigService<AppConfig, true>) {
    const s3Config = configService.get('s3', { infer: true });
    this.bucket = s3Config.bucket;
    this.region = s3Config.region;
    this.endpoint = s3Config.endpoint;
  }

  private getClient(): S3Client {
    if (!this.client) {
      this.client = new S3Client({
        region: this.region,
        endpoint: this.endpoint,
        forcePathStyle: Boolean(this.endpoint),
      });
    }
    return this.client;
  }

  async save(storageKey: string, buffer: Buffer): Promise<void> {
    await this.getClient().send(
      new PutObjectCommand({ Bucket: this.bucket, Key: storageKey, Body: buffer }),
    );
  }

  async read(storageKey: string): Promise<Readable> {
    const response = await this.getClient().send(
      new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }),
    );
    return response.Body as Readable;
  }

  async delete(storageKey: string): Promise<void> {
    await this.getClient().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }));
  }
}
