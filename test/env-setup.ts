import { tmpdir } from 'node:os';
import path from 'node:path';

// Must run before any module (incl. AppModule) is imported, since
// ConfigModule.forRoot's env validation runs at module-decorator
// evaluation time. Registered via jest's `setupFiles` in jest-e2e.json.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'sqlserver://localhost:1433;database=cw_clinic_test';
process.env.CORS_ORIGINS ??= 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-not-for-production-use-only';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-not-for-production-use-only';
// DocumentsService.onModuleInit creates this directory recursively at
// startup — point it at an os-temp path rather than letting it default to
// "<repo>/storage/documents" during test runs.
process.env.DOCUMENTS_STORAGE_DIR ??= path.join(tmpdir(), 'cw-clinic-api-test-documents');
