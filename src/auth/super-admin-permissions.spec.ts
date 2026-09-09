import { PERMISSIONS } from '../../prisma/data/permissions';
import { ROLE_TEMPLATES } from '../../prisma/data/role-templates';

/**
 * SA-01: verifies the seed data itself, not just guard behavior — the
 * `super-admin:*` permission keys exist and are granted only to the
 * SuperAdmin system role template, never to a clinic-scoped role.
 */
describe('Super Admin permission seed data', () => {
  const superAdminPermissionKeys = [
    'super-admin:dashboard-read',
    'super-admin:clinics-read',
    'super-admin:clinics-create',
    'super-admin:clinics-update',
    'super-admin:clinics-activate',
    'super-admin:clinics-suspend',
    'super-admin:clinics-archive',
    'super-admin:platform-users-read',
    'super-admin:platform-users-create',
    'super-admin:platform-users-update',
    'super-admin:plans-read',
    'super-admin:plans-manage',
    'super-admin:subscriptions-read',
    'super-admin:subscriptions-manage',
    'super-admin:feature-flags-read',
    'super-admin:feature-flags-manage',
    'super-admin:configuration-read',
    'super-admin:configuration-update',
    'super-admin:announcements-read',
    'super-admin:announcements-manage',
    'super-admin:audit-logs-read',
    'super-admin:security-events-read',
    'super-admin:system-health-read',
    'super-admin:analytics-read',
  ];

  it('defines every super-admin:* permission in the catalogue', () => {
    const keys = new Set(PERMISSIONS.map((p) => p.key));
    for (const key of superAdminPermissionKeys) {
      expect(keys.has(key)).toBe(true);
    }
  });

  it('grants every super-admin:* permission to the SuperAdmin role template', () => {
    const superAdmin = ROLE_TEMPLATES.find((r) => r.name === 'SuperAdmin');
    expect(superAdmin).toBeDefined();
    for (const key of superAdminPermissionKeys) {
      expect(superAdmin?.permissionKeys).toContain(key);
    }
  });

  it('does not grant any super-admin:* permission to a clinic-scoped role template', () => {
    const clinicRoles = ROLE_TEMPLATES.filter((r) => r.name !== 'SuperAdmin');
    expect(clinicRoles.length).toBeGreaterThan(0);
    for (const role of clinicRoles) {
      const leaked = role.permissionKeys.filter((key) => key.startsWith('super-admin:'));
      expect(leaked).toEqual([]);
    }
  });
});
