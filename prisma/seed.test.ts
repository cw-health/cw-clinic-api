import { PrismaClient } from '@prisma/client';
import { seedReferenceData } from './seed-reference-data';

/**
 * Test seed path — minimal deterministic fixtures the test suite needs,
 * run against an ephemeral/CI database (docs/DATABASE.md §5). Currently
 * just the reference data, since no test exercises clinic/user fixtures
 * yet.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedReferenceData(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('[seed:test] failed:', error);
  process.exit(1);
});
