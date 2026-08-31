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
});
