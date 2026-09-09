// Baseline role -> permission mappings, from the table in
// ../../docs/RBAC.md §2. Seeded as system role templates (Role.clinicId
// null, Role.isSystem true) — reference data, never fake tenant data.
//
// Phase 1D (Staff Management) added Nurse/Pharmacist/LabTechnician to round
// out the org chart in the task brief (Admin, Doctor, Receptionist, Nurse,
// Pharmacist, Lab Technician, Accountant). "Receptionist" and "Accountant"
// are deliberately NOT new role names — they map onto the existing
// FrontDesk and Billing templates respectively (same permission shape,
// different organizational title); renaming those would touch every
// existing reference to them across services/tests/seeds for no behavior
// change, so the Staff module's role picker labels them by their existing
// `description` rather than introducing synonymous Role rows.

export interface RoleTemplateSeed {
  name: string;
  description: string;
  permissionKeys: string[];
}

export const ROLE_TEMPLATES: RoleTemplateSeed[] = [
  {
    name: 'SuperAdmin',
    description: 'Platform-level administrator. Non-clinic-scoped.',
    permissionKeys: [
      'clinics:create',
      'clinics:read',
      'clinics:update',
      'clinics:suspend',
      // Super Admin platform-operations console (SA-01, docs/SUPER_ADMIN_ARCHITECTURE.md
      // §8) — PermissionsGuard does not auto-bypass Super Admin, so every
      // console capability still needs its own explicit grant here, same
      // as any other role.
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
      'super-admin:usage-read',
    ],
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
      'clinic-settings:read',
      'clinic-settings:update',
      // Phase 1B: only ClinicAdmin manages branches — no other role gets
      // any branches:* grant (docs/DECISIONS.md ADR-009).
      'branches:create',
      'branches:read',
      'branches:update',
      'branches:archive',
      // Phase 1C: only ClinicAdmin manages departments — no other role gets
      // any departments:* grant, same reasoning as branches:* above.
      'departments:create',
      'departments:read',
      'departments:update',
      'departments:archive',
      'doctors:create',
      'doctors:read',
      'doctors:update',
      'patients:create',
      'patients:read',
      'patients:update',
      // Patient Master upgrade: archive/restore is ClinicAdmin-only, same
      // pattern as branches:archive/departments:archive above.
      'patients:archive',
      // Phase 5: full appointment control — ClinicAdmin previously had no
      // appointments:* grants at all.
      'appointments:create',
      'appointments:read',
      'appointments:update',
      'appointments:cancel',
      'appointments:reschedule',
      'appointments:confirm',
      'appointments:update-status',
      // Phase 3/4 (queue + consultations): ClinicAdmin needs the clinic-wide
      // queue dashboard and read access to consultation records/patient
      // timeline in the admin app — deliberately read-only, ClinicAdmin
      // never creates/edits a consultation, that stays Doctor-only.
      'queue:manage',
      'consultations:read',
      // Clinical Record upgrade: same "read-only oversight, never edits
      // clinical content" precedent as consultations:read above — a
      // ClinicAdmin sees diagnoses/investigation orders but never
      // creates/edits/amends them.
      'diagnoses:read',
      'investigations:read',
      // Phase 7: read-only prescriptions dashboard + formulary management —
      // same "deliberately read-only for clinical records, ClinicAdmin
      // never prescribes" precedent as consultations:read above.
      'prescriptions:read',
      'medicines:read',
      'medicines:manage',
      // Pharmacy: same "read-only oversight, never operates the counter"
      // precedent as prescriptions:read/consultations:read above.
      'pharmacy:inventory-read',
      'pharmacy:purchases-read',
      'pharmacy:dispense-read',
      // Phase 7 (notifications/documents): ClinicAdmin manages the patient
      // document archive (upload/read/delete) — same staff-wide access
      // shape as FrontDesk below, plus delete since ClinicAdmin is the
      // only role that retires a document.
      'documents:create',
      'documents:read',
      'documents:delete',
    ],
  },
  {
    name: 'Doctor',
    description: 'Clinician: manages own queue, runs consultations, prescribes.',
    permissionKeys: [
      'appointments:read',
      // Phase 5: check-in/start/complete/no-show on the doctor's own
      // appointments — ownership-checked at the service layer (a Doctor
      // caller is scoped to doctorId = own regardless of this grant, see
      // docs/RBAC.md §3), same layering as doctors:read-own under
      // doctors:read.
      'appointments:update-status',
      'queue:manage-own',
      'consultations:create',
      'consultations:read',
      'consultations:update',
      // Clinical Record upgrade: amend + the structured diagnosis/
      // investigation-order child resources are Doctor-only, own
      // consultations (ownership-checked at the service layer, same
      // pattern as consultations:update above).
      'consultations:amend',
      'diagnoses:create',
      'diagnoses:read',
      'diagnoses:delete',
      'investigations:create',
      'investigations:read',
      'investigations:update',
      'prescriptions:create',
      'prescriptions:read',
      'prescriptions:update',
      'medicines:read',
      'doctors:read-own',
      'doctors:update-own',
      // Read-only patient directory access (docs/ROADMAP.md Phase 4 mobile:
      // "Doctor: basic patient access foundation") — a doctor needs to look
      // a patient up by name/MRN ahead of a consultation. Deliberately
      // read-only: registration/edits stay FrontDesk/ClinicAdmin-only.
      'patients:read',
      // Phase 7 (notifications/documents): a doctor sees their own
      // in-app notifications, and can upload/read patient documents
      // (e.g. attaching a lab report ahead of a consultation).
      'notifications:read-own',
      'documents:create',
      'documents:read',
    ],
  },
  {
    name: 'FrontDesk',
    description: 'Reception: registers patients, books appointments, manages queue.',
    permissionKeys: [
      'patients:create',
      'patients:read',
      'patients:update',
      'appointments:create',
      // Phase 5: FrontDesk manages the booking lifecycle day-to-day
      // (reschedule/cancel/confirm/status), on top of the create it
      // already had.
      'appointments:read',
      'appointments:cancel',
      'appointments:reschedule',
      'appointments:confirm',
      'appointments:update-status',
      'queue:manage',
      // Phase 7 (notifications/documents): front desk plausibly
      // scans/attaches referral letters and other paperwork at intake.
      'documents:create',
      'documents:read',
    ],
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
    name: 'Nurse',
    description: 'Clinical support staff: patient intake, queue, read-only consultation access.',
    permissionKeys: [
      'patients:read',
      'patients:update',
      'appointments:read',
      'queue:manage',
      'consultations:read',
      // Clinical Record upgrade: same read-only parity with
      // consultations:read as ClinicAdmin above.
      'diagnoses:read',
      'investigations:read',
      'notifications:read-own',
    ],
  },
  {
    name: 'Pharmacist',
    description: 'Dispenses prescriptions and manages the medicine formulary.',
    permissionKeys: [
      'medicines:read',
      'medicines:manage',
      'prescriptions:read',
      'patients:read',
      'notifications:read-own',
      // Pharmacy inventory/purchase/stock/dispensing chain — Pharmacist is
      // the only role that operates the day-to-day pharmacy counter.
      'pharmacy:inventory-read',
      'pharmacy:inventory-manage',
      'pharmacy:purchases-create',
      'pharmacy:purchases-read',
      'pharmacy:dispense-create',
      'pharmacy:dispense-read',
    ],
  },
  {
    name: 'LabTechnician',
    description:
      'Processes lab work: reads patient/appointment context, attaches result documents.',
    permissionKeys: [
      'patients:read',
      'appointments:read',
      'documents:create',
      'documents:read',
      // Clinical Record upgrade: read-only visibility into investigation
      // orders, ahead of the future Lab module that will let this role
      // actually process one (docs/DATABASE.md §16) — no diagnoses grant,
      // that stays within the clinician/ClinicAdmin/Nurse oversight set.
      'investigations:read',
      'notifications:read-own',
    ],
  },
  {
    name: 'Patient',
    description: "Self-service access to one's own records only.",
    permissionKeys: [
      'appointments:create-own',
      'appointments:read-own',
      // Phase 5: a patient can cancel/reschedule their own booking, same
      // ownership-scoped pattern as create-own/read-own above.
      'appointments:cancel-own',
      'appointments:reschedule-own',
      'prescriptions:read-own',
      'billing:read-own',
      'patients:read-own',
      'patients:update-own',
      // Read-only doctor directory access (docs/ROADMAP.md Phase 5 mobile:
      // "Patient browses doctors" to pick one when booking) — reuses the
      // existing `GET /doctors` endpoint rather than a new directory
      // endpoint. Same "deliberately read-only directory access" precedent
      // as Doctor's reuse of `patients:read` above.
      'doctors:read',
      // Phase 7 (notifications/documents): a patient sees their own
      // in-app notifications and their own uploaded documents.
      'notifications:read-own',
      'documents:read-own',
    ],
  },
];
