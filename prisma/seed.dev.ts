import { PrismaClient } from '@prisma/client';
import { randomBytes, scryptSync } from 'node:crypto';
import { seedReferenceData } from './seed-reference-data';

/**
 * Development seed path — reference data plus a small fixture clinic and
 * users for local development, per docs/DATABASE.md §5. Never run against
 * a shared/production database.
 *
 * Password hashing here is a Phase-1 placeholder (scrypt) since the auth
 * module (argon2id, per docs/SECURITY.md §1) does not exist yet — dev
 * fixture users are not usable for login until auth ships.
 */
function placeholderHash(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    console.log('[seed:dev] seeding reference data...');
    await seedReferenceData(prisma);

    console.log('[seed:dev] seeding fixture clinic and users...');
    const clinic = await prisma.clinic.upsert({
      where: { slug: 'dev-clinic' },
      update: {},
      create: { name: 'Dev Clinic', slug: 'dev-clinic', status: 'ACTIVE' },
    });

    const clinicAdminRole = await prisma.role.findFirst({
      where: { clinicId: null, name: 'ClinicAdmin' },
    });
    const doctorRole = await prisma.role.findFirst({ where: { clinicId: null, name: 'Doctor' } });

    if (!clinicAdminRole || !doctorRole) {
      throw new Error('Role templates missing — seedReferenceData must run before fixtures.');
    }

    const admin = await prisma.user.upsert({
      where: { email: 'admin@dev-clinic.test' },
      update: {},
      create: {
        email: 'admin@dev-clinic.test',
        passwordHash: placeholderHash('DevPassword123!'),
        firstName: 'Dev',
        lastName: 'Admin',
        status: 'ACTIVE',
      },
    });

    const doctor = await prisma.user.upsert({
      where: { email: 'doctor@dev-clinic.test' },
      update: {},
      create: {
        email: 'doctor@dev-clinic.test',
        passwordHash: placeholderHash('DevPassword123!'),
        firstName: 'Dev',
        lastName: 'Doctor',
        status: 'ACTIVE',
      },
    });

    await prisma.clinicMembership.upsert({
      where: { userId_clinicId: { userId: admin.id, clinicId: clinic.id } },
      update: {},
      create: { userId: admin.id, clinicId: clinic.id, roleId: clinicAdminRole.id },
    });

    await prisma.clinicMembership.upsert({
      where: { userId_clinicId: { userId: doctor.id, clinicId: clinic.id } },
      update: {},
      create: { userId: doctor.id, clinicId: clinic.id, roleId: doctorRole.id },
    });

    console.log('[seed:dev] done.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('[seed:dev] failed:', error);
  process.exit(1);
});
