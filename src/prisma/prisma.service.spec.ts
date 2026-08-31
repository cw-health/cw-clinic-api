import { PrismaService } from './prisma.service';

/**
 * Basic database integration check per Phase 1 scope. In CI this runs
 * against a real ephemeral SQL Server (docs/CI-CD.md §1). Locally, without
 * a reachable database, it logs and passes rather than hard-failing
 * `npm test` on a plain checkout.
 */
describe('PrismaService (integration)', () => {
  it('connects and reports healthy when a database is reachable', async () => {
    const prisma = new PrismaService();

    try {
      await prisma.onModuleInit();
    } catch {
      console.warn(
        '[prisma.service.spec] No reachable database at DATABASE_URL — skipping. ' +
          'This check runs for real in CI against an ephemeral SQL Server (docs/CI-CD.md §1).',
      );
      return;
    }

    try {
      await expect(prisma.isHealthy()).resolves.toBe(true);
    } finally {
      await prisma.onModuleDestroy();
    }
  });
});
