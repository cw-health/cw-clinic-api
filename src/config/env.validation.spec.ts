import { validateEnvironment } from './env.validation';

describe('validateEnvironment', () => {
  const validConfig = {
    NODE_ENV: 'development',
    PORT: '3000',
    DATABASE_URL: 'sqlserver://localhost:1433;database=cw_clinic',
    CORS_ORIGINS: 'http://localhost:5173',
    THROTTLE_TTL_MS: '60000',
    THROTTLE_LIMIT: '100',
    JWT_ACCESS_SECRET: 'test-access-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
  };

  it('accepts a valid configuration and coerces types', () => {
    const result = validateEnvironment(validConfig);
    expect(result.PORT).toBe('3000');
    expect(result.NODE_ENV).toBe('development');
  });

  it('rejects a missing DATABASE_URL', () => {
    const { DATABASE_URL: _omit, ...rest } = validConfig;
    expect(() => validateEnvironment(rest)).toThrow(/Environment validation failed/);
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() => validateEnvironment({ ...validConfig, NODE_ENV: 'staging' })).toThrow(
      /Environment validation failed/,
    );
  });

  it('accepts a non-numeric PORT (iisnode assigns a named-pipe path on Windows Plesk)', () => {
    const result = validateEnvironment({ ...validConfig, PORT: '\\\\.\\pipe\\some-guid' });
    expect(result.PORT).toBe('\\\\.\\pipe\\some-guid');
  });

  it('rejects an empty PORT', () => {
    expect(() => validateEnvironment({ ...validConfig, PORT: '' })).toThrow(
      /Environment validation failed/,
    );
  });

  it('defaults DOCUMENTS_STORAGE_DIR when not set', () => {
    const result = validateEnvironment(validConfig);
    expect(result.DOCUMENTS_STORAGE_DIR).toBe('./storage/documents');
  });

  it('accepts a custom DOCUMENTS_STORAGE_DIR', () => {
    const result = validateEnvironment({ ...validConfig, DOCUMENTS_STORAGE_DIR: '/data/docs' });
    expect(result.DOCUMENTS_STORAGE_DIR).toBe('/data/docs');
  });
});
