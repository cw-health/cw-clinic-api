// Must run before any module (incl. AppModule) is imported, since
// ConfigModule.forRoot's env validation runs at module-decorator
// evaluation time. Registered via jest's `setupFiles` in jest-e2e.json.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'sqlserver://localhost:1433;database=cw_clinic_test';
process.env.CORS_ORIGINS ??= 'http://localhost:5173';
