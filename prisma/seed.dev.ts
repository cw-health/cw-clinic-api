import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/password.util';
import { seedReferenceData } from './seed-reference-data';

/**
 * Development seed path — reference data plus a small fixture clinic and
 * users (one per role) for local development, per docs/DATABASE.md §5.
 * Never run against a shared/production database. All fixture users share
 * the password below and use the real auth module hashing (argon2id, per
 * docs/SECURITY.md §1) so they're directly usable against POST /auth/login.
 */
const DEV_PASSWORD = 'DevPassword123!';

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

    // A second clinic so cross-tenant isolation is actually exercisable
    // in dev/manual testing, not just asserted in unit tests.
    const otherClinic = await prisma.clinic.upsert({
      where: { slug: 'other-clinic' },
      update: {},
      create: { name: 'Other Clinic', slug: 'other-clinic', status: 'ACTIVE' },
    });

    const roleNames = ['ClinicAdmin', 'Doctor', 'FrontDesk', 'Patient'] as const;
    const roles = await prisma.role.findMany({
      where: { clinicId: null, name: { in: [...roleNames] } },
    });
    const roleByName = new Map(roles.map((role) => [role.name, role]));
    for (const name of roleNames) {
      if (!roleByName.has(name)) {
        throw new Error(
          `Role template "${name}" missing — seedReferenceData must run before fixtures.`,
        );
      }
    }

    const passwordHash = await hashPassword(DEV_PASSWORD);

    const fixtures: Array<{
      email: string;
      firstName: string;
      lastName: string;
      role: (typeof roleNames)[number];
    }> = [
      { email: 'admin@dev-clinic.test', firstName: 'Dev', lastName: 'Admin', role: 'ClinicAdmin' },
      { email: 'doctor@dev-clinic.test', firstName: 'Dev', lastName: 'Doctor', role: 'Doctor' },
      {
        email: 'receptionist@dev-clinic.test',
        firstName: 'Dev',
        lastName: 'Receptionist',
        role: 'FrontDesk',
      },
      { email: 'patient@dev-clinic.test', firstName: 'Dev', lastName: 'Patient', role: 'Patient' },
    ];

    for (const fixture of fixtures) {
      const user = await prisma.user.upsert({
        where: { email: fixture.email },
        update: { passwordHash },
        create: {
          email: fixture.email,
          passwordHash,
          firstName: fixture.firstName,
          lastName: fixture.lastName,
          status: 'ACTIVE',
        },
      });

      await prisma.clinicMembership.upsert({
        where: { userId_clinicId: { userId: user.id, clinicId: clinic.id } },
        update: {},
        create: { userId: user.id, clinicId: clinic.id, roleId: roleByName.get(fixture.role)!.id },
      });
    }

    // A fixture user who only belongs to the *other* clinic — used to
    // manually verify cross-tenant denial against `clinic`-scoped data.
    const otherClinicAdmin = await prisma.user.upsert({
      where: { email: 'admin@other-clinic.test' },
      update: { passwordHash },
      create: {
        email: 'admin@other-clinic.test',
        passwordHash,
        firstName: 'Other',
        lastName: 'Admin',
        status: 'ACTIVE',
      },
    });
    await prisma.clinicMembership.upsert({
      where: { userId_clinicId: { userId: otherClinicAdmin.id, clinicId: otherClinic.id } },
      update: {},
      create: {
        userId: otherClinicAdmin.id,
        clinicId: otherClinic.id,
        roleId: roleByName.get('ClinicAdmin')!.id,
      },
    });

    await prisma.user.upsert({
      where: { email: 'superadmin@cw-clinic.test' },
      update: { passwordHash, isSuperAdmin: true },
      create: {
        email: 'superadmin@cw-clinic.test',
        passwordHash,
        firstName: 'Super',
        lastName: 'Admin',
        status: 'ACTIVE',
        isSuperAdmin: true,
      },
    });

    console.log(`[seed:dev] done. All fixture users share the password: ${DEV_PASSWORD}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('[seed:dev] failed:', error);
  process.exit(1);
});
