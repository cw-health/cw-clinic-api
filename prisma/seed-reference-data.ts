import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from './data/permissions';
import { ROLE_TEMPLATES } from './data/role-templates';
import { SPECIALIZATIONS } from './data/specializations';

/**
 * Idempotent: safe to run repeatedly. Seeds only platform reference data
 * (permission definitions + system role templates) — never tenant/fake
 * data. Shared by dev/test/prod seed profiles per docs/DATABASE.md §5.
 */
export async function seedReferenceData(prisma: PrismaClient): Promise<void> {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description, category: permission.category },
      create: permission,
    });
  }

  for (const template of ROLE_TEMPLATES) {
    const existing = await prisma.role.findFirst({
      where: { clinicId: null, name: template.name },
    });

    const role = existing
      ? await prisma.role.update({
          where: { id: existing.id },
          data: { description: template.description, isSystem: true },
        })
      : await prisma.role.create({
          data: {
            name: template.name,
            description: template.description,
            isSystem: true,
            clinicId: null,
          },
        });

    const permissions = await prisma.permission.findMany({
      where: { key: { in: template.permissionKeys } },
      select: { id: true },
    });

    // SQL Server's connector doesn't support createMany's skipDuplicates, so
    // duplicates are avoided by clearing existing links first, in the same
    // transaction.
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
      }),
    ]);
  }

  for (const name of SPECIALIZATIONS) {
    await prisma.specialization.upsert({ where: { name }, update: {}, create: { name } });
  }
}
