// Baseline role -> permission mappings, from the table in
// ../../docs/RBAC.md §2. Seeded as system role templates (Role.clinicId
// null, Role.isSystem true) — reference data, never fake tenant data.

export interface RoleTemplateSeed {
  name: string;
  description: string;
  permissionKeys: string[];
}

export const ROLE_TEMPLATES: RoleTemplateSeed[] = [
  {
    name: 'SuperAdmin',
    description: 'Platform-level administrator. Non-clinic-scoped.',
    permissionKeys: ['clinics:create', 'clinics:read', 'clinics:update', 'clinics:suspend'],
  },
  {
    name: 'ClinicAdmin',
    description: 'Full administrative access within a single clinic.',
    permissionKeys: [
      'users:create',
      'users:read',
      'users:update',
      'users:delete',
      'roles:create',
      'roles:read',
      'roles:update',
      'roles:delete',
      'billing:create',
      'billing:read',
      'billing:update',
      'billing:refund',
      'payments:create',
      'payments:read',
    ],
  },
  {
    name: 'Doctor',
    description: 'Clinician: manages own queue, runs consultations, prescribes.',
    permissionKeys: [
      'appointments:read',
      'queue:manage-own',
      'consultations:create',
      'consultations:read',
      'consultations:update',
      'prescriptions:create',
    ],
  },
  {
    name: 'FrontDesk',
    description: 'Reception: registers patients, books appointments, manages queue.',
    permissionKeys: ['patients:create', 'patients:read', 'appointments:create', 'queue:manage'],
  },
  {
    name: 'Billing',
    description: 'Billing staff: invoicing, payments, financial reporting.',
    permissionKeys: [
      'billing:create',
      'billing:read',
      'billing:update',
      'billing:refund',
      'payments:create',
      'payments:read',
      'reports:financial',
    ],
  },
  {
    name: 'Patient',
    description: "Self-service access to one's own records only.",
    permissionKeys: [
      'appointments:create-own',
      'appointments:read-own',
      'prescriptions:read-own',
      'billing:read-own',
    ],
  },
];
