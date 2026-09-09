import { Type, plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min, validateSync } from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

export class EnvironmentVariables {
  @IsIn([NodeEnv.Development, NodeEnv.Test, NodeEnv.Production])
  NODE_ENV: NodeEnv = NodeEnv.Development;

  // Kept as a plain string, not validated as a bounded integer: iisnode
  // (Windows Plesk) assigns this as a named-pipe path (e.g. "\\.\pipe\...")
  // rather than a TCP port number, and app.listen() needs the raw value
  // either way — see src/main.ts for the numeric-vs-pipe-path handling.
  @IsString()
  @IsNotEmpty()
  PORT = '3000';

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  CORS_ORIGINS!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  THROTTLE_TTL_MS = 60000;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  THROTTLE_LIMIT = 100;

  @IsOptional()
  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL = 'info';

  @IsOptional()
  @IsIn(['true', 'false'])
  API_DOCS_ENABLED = 'true';

  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_SECRET!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_EXPIRES_IN = '15m';

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_SECRET!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_EXPIRES_IN = '7d';

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  REFRESH_COOKIE_NAME = 'cw_refresh_token';

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  DOCUMENTS_STORAGE_DIR = './storage/documents';

  @IsOptional()
  @IsIn(['local', 's3'])
  STORAGE_DRIVER = 'local';

  @IsOptional()
  @IsString()
  S3_BUCKET = '';

  @IsOptional()
  @IsString()
  S3_REGION = '';

  @IsOptional()
  @IsString()
  S3_ENDPOINT = '';

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  REDIS_HOST = '127.0.0.1';

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  REDIS_PORT = 6379;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD = '';

  @IsOptional()
  @IsString()
  FCM_SERVICE_ACCOUNT_JSON = '';
}

export function validateEnvironment(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    const message = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Environment validation failed: ${message}`);
  }

  return validatedConfig;
}
