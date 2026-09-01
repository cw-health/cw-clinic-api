// Baseline permission catalogue — sourced from the example permissions and
// role grants in ../../docs/RBAC.md §1-2. Wildcards in that doc (e.g.
// "billing:*") are expanded here into concrete permission keys since a
// PermissionsGuard checks an exact key, not a pattern.

export interface PermissionSeed {
  key: string;
  description: string;
  category: string;
}

export const PERMISSIONS: PermissionSeed[] = [
  // clinics:* (SuperAdmin)
  { key: 'clinics:create', description: 'Create a new clinic tenant', category: 'clinics' },
  { key: 'clinics:read', description: 'View clinic tenants', category: 'clinics' },
  { key: 'clinics:update', description: 'Update clinic tenant settings', category: 'clinics' },
  { key: 'clinics:suspend', description: 'Suspend a clinic tenant', category: 'clinics' },

  // users:* (ClinicAdmin)
  { key: 'users:create', description: 'Create a user within the clinic', category: 'users' },
  { key: 'users:read', description: 'View users within the clinic', category: 'users' },
  { key: 'users:update', description: 'Update a user within the clinic', category: 'users' },
  { key: 'users:delete', description: 'Remove a user from the clinic', category: 'users' },

  // roles:* (ClinicAdmin)
  { key: 'roles:create', description: 'Create a role within the clinic', category: 'roles' },
  { key: 'roles:read', description: 'View roles within the clinic', category: 'roles' },
  { key: 'roles:update', description: "Update a role's permissions", category: 'roles' },
  { key: 'roles:delete', description: 'Delete a role within the clinic', category: 'roles' },

  // billing:* / payments:* (Billing, ClinicAdmin)
  { key: 'billing:create', description: 'Create an invoice', category: 'billing' },
  { key: 'billing:read', description: 'View invoices', category: 'billing' },
  { key: 'billing:update', description: 'Update an invoice', category: 'billing' },
  { key: 'billing:refund', description: 'Issue a billing refund', category: 'billing' },
  {
    key: 'billing:read-own',
    description: "View one's own invoices (Patient)",
    category: 'billing',
  },
  { key: 'payments:create', description: 'Capture a payment', category: 'payments' },
  { key: 'payments:read', description: 'View payments', category: 'payments' },

  // reports (Billing)
  { key: 'reports:financial', description: 'View financial reports', category: 'reports' },
  { key: 'reports:export', description: 'Export report data', category: 'reports' },

  // appointments (Doctor, FrontDesk, Patient)
  {
    key: 'appointments:create',
    description: 'Create an appointment for a patient',
    category: 'appointments',
  },
  { key: 'appointments:read', description: 'View appointments', category: 'appointments' },
  {
    key: 'appointments:create-own',
    description: "Create one's own appointment (Patient)",
    category: 'appointments',
  },
  {
    key: 'appointments:read-own',
    description: "View one's own appointments (Patient)",
    category: 'appointments',
  },

  // queue (Doctor, FrontDesk)
  { key: 'queue:manage', description: 'Manage the clinic queue', category: 'queue' },
  {
    key: 'queue:manage-own',
    description: "Manage one's own position in the queue (Doctor)",
    category: 'queue',
  },

  // consultations:* (Doctor)
  { key: 'consultations:create', description: 'Start a consultation', category: 'consultations' },
  { key: 'consultations:read', description: 'View consultations', category: 'consultations' },
  {
    key: 'consultations:update',
    description: 'Update a consultation record',
    category: 'consultations',
  },

  // prescriptions (Doctor, Patient)
  { key: 'prescriptions:create', description: 'Create a prescription', category: 'prescriptions' },
  {
    key: 'prescriptions:read-own',
    description: "View one's own prescriptions (Patient)",
    category: 'prescriptions',
  },

  // patients (FrontDesk)
  { key: 'patients:create', description: 'Create a patient record', category: 'patients' },
  { key: 'patients:read', description: 'View patient records', category: 'patients' },
];
