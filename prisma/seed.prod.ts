import { PrismaClient } from '@prisma/client';
import { seedReferenceData } from './seed-reference-data';

/**
 * Production seed path. Reference data ONLY (permissions, system role
 * templates) — never fake clinics/doctors/patients. Never wired into CD;
 * this is a deliberate, manually-triggered operation (docs/DATABASE.md §5).
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    console.log('[seed:prod] seeding reference data (permissions, role templates)...');
    await seedReferenceData(prisma);
    console.log('[seed:prod] done.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('[seed:prod] failed:', error);
  process.exit(1);
});
