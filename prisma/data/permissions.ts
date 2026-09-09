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

  // super-admin:* (SuperAdmin) — platform-operations console permissions
  // (docs/SUPER_ADMIN_ARCHITECTURE.md §8), namespaced separately from
  // clinics:* (the tenant-registry permissions above, kept as-is). This
  // phase (SA-01) only seeds the permission keys and grants them to the
  // SuperAdmin role template; the endpoints/UI that require them are
  // built in later phases (SA-03 onward) per module.
  {
    key: 'super-admin:dashboard-read',
    description: 'View the Super Admin platform dashboard',
    category: 'super-admin',
  },
  {
    key: 'super-admin:clinics-read',
    description: 'View clinic tenants from the Super Admin console',
    category: 'super-admin',
  },
  {
    key: 'super-admin:clinics-create',
    description: 'Provision a new clinic tenant',
    category: 'super-admin',
  },
  {
    key: 'super-admin:clinics-update',
    description: 'Update a clinic tenant from the Super Admin console',
    category: 'super-admin',
  },
  {
    key: 'super-admin:clinics-activate',
    description: 'Activate a clinic tenant',
    category: 'super-admin',
  },
  {
    key: 'super-admin:clinics-suspend',
    description: 'Suspend a clinic tenant',
    category: 'super-admin',
  },
  {
    key: 'super-admin:clinics-archive',
    description: 'Archive a clinic tenant',
    category: 'super-admin',
  },
  {
    key: 'super-admin:platform-users-read',
    description: 'View platform (Super Admin) users',
    category: 'super-admin',
  },
  {
    key: 'super-admin:platform-users-create',
    description: 'Create a platform (Super Admin) user',
    category: 'super-admin',
  },
  {
    key: 'super-admin:platform-users-update',
    description: 'Update a platform (Super Admin) user',
    category: 'super-admin',
  },
  {
    key: 'super-admin:plans-read',
    description: 'View subscription plans',
    category: 'super-admin',
  },
  {
    key: 'super-admin:plans-manage',
    description: 'Create or update subscription plans',
    category: 'super-admin',
  },
  {
    key: 'super-admin:subscriptions-read',
    description: "View clinics' subscriptions",
    category: 'super-admin',
  },
  {
    key: 'super-admin:subscriptions-manage',
    description: "Manage clinics' subscriptions",
    category: 'super-admin',
  },
  {
    key: 'super-admin:feature-flags-read',
    description: 'View feature flags',
    category: 'super-admin',
  },
  {
    key: 'super-admin:feature-flags-manage',
    description: 'Manage feature flags',
    category: 'super-admin',
  },
  {
    key: 'super-admin:configuration-read',
    description: 'View platform configuration',
    category: 'super-admin',
  },
  {
    key: 'super-admin:configuration-update',
    description: 'Update platform configuration',
    category: 'super-admin',
  },
  {
    key: 'super-admin:announcements-read',
    description: 'View platform announcements',
    category: 'super-admin',
  },
  {
    key: 'super-admin:announcements-manage',
    description: 'Create or manage platform announcements',
    category: 'super-admin',
  },
  {
    key: 'super-admin:audit-logs-read',
    description: 'View audit logs from the Super Admin console',
    category: 'super-admin',
  },
  {
    key: 'super-admin:security-events-read',
    description: 'View platform security events',
    category: 'super-admin',
  },
  {
    key: 'super-admin:system-health-read',
    description: 'View platform system health',
    category: 'super-admin',
  },
  {
    key: 'super-admin:analytics-read',
    description: 'View platform analytics',
    category: 'super-admin',
  },
  {
    key: 'super-admin:usage-read',
    description: 'View clinic usage against plan limits',
    category: 'super-admin',
  },

  // users:* (ClinicAdmin)
  { key: 'users:create', description: 'Create a user within the clinic', category: 'users' },
  { key: 'users:read', description: 'View users within the clinic', category: 'users' },
  { key: 'users:update', description: 'Update a user within the clinic', category: 'users' },
  { key: 'users:delete', description: 'Remove a user from the clinic', category: 'users' },

  // roles:* (ClinicAdmin)
  { key: 'roles:create', description: 'Create a role within the clinic', category: 'roles' },
  { key: 'roles:read', description: 'View roles within the clinic', category: 'roles' },
  { key: 'roles:update', description: "Update a role's permissions", category: 'roles' },
  {
    key: 'roles:delete',
    description: 'Archive (deactivate) a custom role within the clinic',
    category: 'roles',
  },

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

  // appointments (Doctor, FrontDesk, Patient) — Phase 5
  {
    key: 'appointments:create',
    description: 'Create an appointment for a patient',
    category: 'appointments',
  },
  { key: 'appointments:read', description: 'View appointments', category: 'appointments' },
  {
    key: 'appointments:update',
    description: "Update an appointment's non-status fields (reason, notes)",
    category: 'appointments',
  },
  { key: 'appointments:cancel', description: 'Cancel an appointment', category: 'appointments' },
  {
    key: 'appointments:cancel-own',
    description: "Cancel one's own appointment (Patient)",
    category: 'appointments',
  },
  {
    key: 'appointments:reschedule',
    description: 'Reschedule an appointment',
    category: 'appointments',
  },
  {
    key: 'appointments:reschedule-own',
    description: "Reschedule one's own appointment (Patient)",
    category: 'appointments',
  },
  {
    key: 'appointments:confirm',
    description: 'Confirm a scheduled appointment',
    category: 'appointments',
  },
  {
    key: 'appointments:update-status',
    description: 'Advance an appointment through check-in/start/complete/no-show',
    category: 'appointments',
  },
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
  // Clinical Record upgrade (docs/DATABASE.md §16): a distinct grant from
  // consultations:update — amending a COMPLETED/locked consultation is a
  // controlled, reason-required correction, not an ordinary edit.
  {
    key: 'consultations:amend',
    description: 'Amend a completed (locked) consultation with a recorded reason',
    category: 'consultations',
  },

  // diagnoses (Doctor, ClinicAdmin, Nurse) — structured diagnosis entries
  // on a Consultation, folded under the consultations catalog module
  // (docs/RBAC.md §7) since they're the same clinical-record aggregate.
  {
    key: 'diagnoses:create',
    description: 'Add a structured diagnosis entry to a consultation',
    category: 'consultations',
  },
  {
    key: 'diagnoses:read',
    description: 'View a consultation’s structured diagnosis entries',
    category: 'consultations',
  },
  {
    key: 'diagnoses:delete',
    description: 'Remove a structured diagnosis entry from an in-progress consultation',
    category: 'consultations',
  },

  // investigations:* (Doctor, ClinicAdmin, Nurse, LabTechnician) —
  // structured investigation orders on a Consultation. Own catalog
  // module: unlike diagnoses, LabTechnician needs a scoped grant here
  // ahead of the future Lab module (docs/DATABASE.md §16).
  {
    key: 'investigations:create',
    description: 'Order a structured investigation from a consultation',
    category: 'investigations',
  },
  {
    key: 'investigations:read',
    description: 'View investigation orders',
    category: 'investigations',
  },
  {
    key: 'investigations:update',
    description: 'Cancel an investigation order',
    category: 'investigations',
  },

  // prescriptions (Doctor, ClinicAdmin, Patient)
  { key: 'prescriptions:create', description: 'Create a prescription', category: 'prescriptions' },
  { key: 'prescriptions:read', description: 'View prescriptions', category: 'prescriptions' },
  {
    key: 'prescriptions:update',
    description: 'Edit a draft prescription, finalize it, or amend a finalized one',
    category: 'prescriptions',
  },
  {
    key: 'prescriptions:read-own',
    description: "View one's own prescriptions (Patient)",
    category: 'prescriptions',
  },

  // medicines (Doctor, ClinicAdmin) — the prescribing formulary
  { key: 'medicines:read', description: 'Search the medicine catalog', category: 'medicines' },
  {
    key: 'medicines:manage',
    description: 'Create, update, or retire a medicine catalog entry',
    category: 'medicines',
  },

  // pharmacy (Pharmacist, ClinicAdmin read-only) — inventory/purchase/
  // stock/dispensing, built on the medicines formulary above. Deliberately
  // no `pharmacy:manage` catch-all: each stage of the chain (inventory
  // view, receiving stock, adjusting/writing off stock, dispensing) is its
  // own grant, same "one permission per concrete action" convention as
  // billing/prescriptions above.
  {
    key: 'pharmacy:inventory-read',
    description: 'View medicine batches and current stock levels',
    category: 'pharmacy',
  },
  {
    key: 'pharmacy:inventory-manage',
    description: 'Record a manual stock movement (return, adjustment, expired, damaged)',
    category: 'pharmacy',
  },
  {
    key: 'pharmacy:purchases-create',
    description: 'Record a purchase (stock receipt) into inventory',
    category: 'pharmacy',
  },
  { key: 'pharmacy:purchases-read', description: 'View purchase records', category: 'pharmacy' },
  {
    key: 'pharmacy:dispense-create',
    description: 'Dispense medicine against a prescription or over the counter',
    category: 'pharmacy',
  },
  { key: 'pharmacy:dispense-read', description: 'View dispensing records', category: 'pharmacy' },

  // patients (FrontDesk, ClinicAdmin)
  { key: 'patients:create', description: 'Create a patient record', category: 'patients' },
  { key: 'patients:read', description: 'View patient records', category: 'patients' },
  { key: 'patients:update', description: 'Update a patient record', category: 'patients' },
  {
    key: 'patients:read-own',
    description: "View one's own patient profile (Patient)",
    category: 'patients',
  },
  {
    key: 'patients:update-own',
    description: "Update one's own patient profile (Patient)",
    category: 'patients',
  },
  {
    key: 'patients:archive',
    description: 'Archive or restore a patient record (ClinicAdmin only)',
    category: 'patients',
  },

  // clinic-settings (ClinicAdmin) — the clinic's own profile/contact/
  // address/working-hours/holidays/settings, distinct from clinics:* which
  // is the SuperAdmin's platform-level tenant registry.
  {
    key: 'clinic-settings:read',
    description: "View the clinic's own profile and settings",
    category: 'clinic-settings',
  },
  {
    key: 'clinic-settings:update',
    description: "Update the clinic's own profile and settings",
    category: 'clinic-settings',
  },

  // branches (ClinicAdmin only — Phase 1B) — organizational units under a
  // clinic (docs/DECISIONS.md ADR-009). No "own"/self-service variant:
  // unlike doctors/patients, a branch has no single owning user.
  { key: 'branches:create', description: 'Create a branch for the clinic', category: 'branches' },
  { key: 'branches:read', description: "View the clinic's branches", category: 'branches' },
  { key: 'branches:update', description: 'Update a branch', category: 'branches' },
  { key: 'branches:archive', description: 'Archive a branch', category: 'branches' },

  // departments (ClinicAdmin only — Phase 1C) — organizational units under a
  // Branch (Clinic -> Branch -> Department), distinct from the global
  // Specialization taxonomy. No "own"/self-service variant: same reasoning
  // as branches:* above — a department has no single owning user.
  {
    key: 'departments:create',
    description: 'Create a department under a branch',
    category: 'departments',
  },
  {
    key: 'departments:read',
    description: "View the clinic's departments",
    category: 'departments',
  },
  { key: 'departments:update', description: 'Update a department', category: 'departments' },
  { key: 'departments:archive', description: 'Archive a department', category: 'departments' },

  // doctors (ClinicAdmin manages the directory; Doctor manages own profile)
  { key: 'doctors:create', description: 'Create a doctor record', category: 'doctors' },
  { key: 'doctors:read', description: 'View doctor records', category: 'doctors' },
  { key: 'doctors:update', description: 'Update a doctor record', category: 'doctors' },
  {
    key: 'doctors:read-own',
    description: "View one's own doctor profile (Doctor)",
    category: 'doctors',
  },
  {
    key: 'doctors:update-own',
    description: "Update one's own doctor profile and availability (Doctor)",
    category: 'doctors',
  },

  // notifications (Doctor, Patient) — Phase 7
  {
    key: 'notifications:read-own',
    description: "View one's own notifications (Doctor, Patient)",
    category: 'notifications',
  },

  // documents (ClinicAdmin, FrontDesk, Doctor, Patient) — Phase 7
  {
    key: 'documents:create',
    description: 'Upload a document against a patient record',
    category: 'documents',
  },
  { key: 'documents:read', description: 'View any patient document', category: 'documents' },
  {
    key: 'documents:read-own',
    description: "View one's own documents (Patient)",
    category: 'documents',
  },
  { key: 'documents:delete', description: 'Soft-delete a patient document', category: 'documents' },
];
