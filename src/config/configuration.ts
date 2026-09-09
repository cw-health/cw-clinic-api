import path from 'node:path';

export interface AppConfig {
  nodeEnv: string;
  // Kept as a raw string — may be a TCP port number or (under iisnode on
  // Windows Plesk) a named-pipe path. See src/main.ts for how it's used.
  port: string;
  databaseUrl: string;
  corsOrigins: string[];
  throttle: {
    ttlMs: number;
    limit: number;
  };
  logLevel: string;
  apiDocsEnabled: boolean;
  jwt: {
    accessSecret: string;
    accessExpiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
  };
  refreshCookieName: string;
  /// Absolute path to the local-disk root for uploaded documents
  /// (docs/SECURITY.md §9: stored outside the public webroot). Resolved
  /// relative to process.cwd() if DOCUMENTS_STORAGE_DIR is a relative path.
  documentsStorageDir: string;
  /// Which DocumentStorageProvider backs the `documents` module
  /// (docs/DECISIONS.md ADR-008). 'local' (default) uses documentsStorageDir
  /// above; 's3' uses the s3 config block below.
  storageDriver: 'local' | 's3';
  s3: {
    bucket: string;
    region: string;
    endpoint?: string;
  };
  /// BullMQ/Redis connection for the `jobs` module (docs/DECISIONS.md ADR-008).
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  /// FCM service account credentials JSON (raw string, parsed at provider
  /// construction) for FcmNotificationProvider. Undefined in dev/test unless
  /// explicitly configured — the provider then logs and skips delivery
  /// rather than crashing the app.
  fcmServiceAccountJson?: string;
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: process.env.PORT ?? '3000',
  databaseUrl: process.env.DATABASE_URL ?? '',
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  throttle: {
    ttlMs: parseInt(process.env.THROTTLE_TTL_MS ?? '60000', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
  },
  logLevel: process.env.LOG_LEVEL ?? 'info',
  apiDocsEnabled: (process.env.API_DOCS_ENABLED ?? 'true') === 'true',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  refreshCookieName: process.env.REFRESH_COOKIE_NAME ?? 'cw_refresh_token',
  documentsStorageDir: path.resolve(
    process.cwd(),
    process.env.DOCUMENTS_STORAGE_DIR ?? './storage/documents',
  ),
  storageDriver: process.env.STORAGE_DRIVER === 's3' ? 's3' : 'local',
  s3: {
    bucket: process.env.S3_BUCKET ?? '',
    region: process.env.S3_REGION ?? '',
    endpoint: process.env.S3_ENDPOINT || undefined,
  },
  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  fcmServiceAccountJson: process.env.FCM_SERVICE_ACCOUNT_JSON || undefined,
});
