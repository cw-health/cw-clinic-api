import { validateEnvironment } from './env.validation';

describe('validateEnvironment', () => {
  const validConfig = {
    NODE_ENV: 'development',
    PORT: '3000',
    DATABASE_URL: 'sqlserver://localhost:1433;database=cw_clinic',
    CORS_ORIGINS: 'http://localhost:5173',
    THROTTLE_TTL_MS: '60000',
    THROTTLE_LIMIT: '100',
  };

  it('accepts a valid configuration and coerces types', () => {
    const result = validateEnvironment(validConfig);
    expect(result.PORT).toBe(3000);
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

  it('rejects a PORT outside the valid range', () => {
    expect(() => validateEnvironment({ ...validConfig, PORT: '70000' })).toThrow(
      /Environment validation failed/,
    );
  });
});
