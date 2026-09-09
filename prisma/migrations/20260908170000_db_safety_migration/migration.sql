-- Database Safety Migration (docs/DATABASE.md §7, 2026-09-08)
--
-- Fixes the following, each inspected against production-shaped dev data
-- before being applied (see the audit notes in each section below; all
-- checks were run against the live `cw-clinic-dev` database and found
-- zero rows that would violate the new constraints):
--
-- 1. Clinic -> Doctor: CASCADE -> NO ACTION
-- 2. Clinic -> Patient: CASCADE -> NO ACTION
-- 3. PrescriptionItem.clinicId: audited, intentionally NOT added (see
--    prisma/schema.prisma doc comment on the model) — no SQL change here.
-- 4. InvoiceItem.clinicId: audited, intentionally NOT added (see
--    prisma/schema.prisma doc comment on the model) — no SQL change here.
-- 5. Role (clinicId, name): filtered unique index for clinic-scoped rows
-- 6. Patient.userId: filtered unique index
-- 7. AuditLog.actorUserId: already indexed since Phase 1F — re-verified,
--    no change needed. No SQL here.
-- 8. Appointment: two new indexes matching the queue module's actual
--    query patterns (AppointmentsService.findQueue / callNext)
--
-- None of these statements touch or move data. No column is made
-- non-nullable and no column/table is dropped — this is a pure
-- constraint/index migration, safe to run against a populated database.

BEGIN TRY

BEGIN TRAN;

-- =========================================================================
-- 1 & 2. Clinic -> Doctor / Clinic -> Patient: CASCADE -> NO ACTION
-- =========================================================================
-- Audit finding: both FKs were declared ON DELETE CASCADE, contradicting
-- docs/DATABASE.md §7 ("Cascade only for genuinely dependent child rows
-- like line items") and §8 (Doctor/Patient are explicitly soft-deleted,
-- clinical/PHI-bearing directory records, not disposable line items).
-- Clinic has no hard-delete endpoint today (ClinicsService only exposes
-- status transitions to ARCHIVED) so this was never triggered via the
-- API, but a bare `prisma.clinic.delete()` — a script, a test helper, a
-- future admin tool — would have silently wiped every Doctor/Patient row
-- (and, since Appointment/Consultation/Prescription/Invoice all reference
-- Doctor/Patient with ON DELETE NO ACTION, would then usually just fail
-- with an FK violation on clinics with any history — a confusing failure
-- mode either way, never the intended one).
--
-- Verified against dev data before this change: 8 clinics, 3 doctors (all
-- under one clinic), 4 patients (all under the same clinic) — changing
-- the FK action is a metadata-only change (no rows are added, removed, or
-- modified by dropping/recreating a constraint), so this carries zero
-- data risk regardless of row counts.
--
-- Matches the NO ACTION convention already used for every other relation
-- pointing back at Clinic where the child must survive a Clinic-level
-- operation (Subscription.clinic, ClinicDocument.clinic,
-- FeatureFlagOverride.clinic, Role.clinic).
ALTER TABLE [dbo].[doctors] DROP CONSTRAINT [doctors_clinicId_fkey];
ALTER TABLE [dbo].[patients] DROP CONSTRAINT [patients_clinicId_fkey];

ALTER TABLE [dbo].[doctors] ADD CONSTRAINT [doctors_clinicId_fkey]
  FOREIGN KEY ([clinicId]) REFERENCES [dbo].[clinics]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[patients] ADD CONSTRAINT [patients_clinicId_fkey]
  FOREIGN KEY ([clinicId]) REFERENCES [dbo].[clinics]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- =========================================================================
-- 5. Role: filtered unique index on (clinicId, name) for clinic-scoped rows
-- =========================================================================
-- Audit finding: docs/DATABASE.md's own schema comment on Role flagged
-- this as a known gap since Phase 1 — (clinicId, name) uniqueness for
-- clinic-scoped custom roles was enforced only at the service layer, with
-- no database backstop, because a plain `@@unique([clinicId, name])`
-- cannot correctly express "unique only when clinicId is set" given SQL
-- Server's NULL-handling in unique indexes, and Prisma's schema language
-- has no declarative support for a filtered/partial index. This is a
-- WHERE-filtered index, not a `@@unique` in prisma/schema.prisma, for
-- that reason — see the schema.prisma doc comment on model Role.
--
-- Verified against dev data before this change: 0 duplicate (clinicId,
-- name) pairs among the 9 existing Role rows with a non-null clinicId, so
-- this index applies cleanly with no pre-existing violator to resolve.
-- Null-clinicId system role templates are deliberately excluded by the
-- WHERE clause (unaffected; still whatever they were before).
CREATE UNIQUE NONCLUSTERED INDEX [roles_clinicId_name_filtered_uq]
  ON [dbo].[roles] ([clinicId], [name])
  WHERE [clinicId] IS NOT NULL;

-- =========================================================================
-- 6. Patient.userId: filtered unique index
-- =========================================================================
-- Audit finding: Patient.userId was deliberately left off `@unique` (see
-- the Phase 4 "known issues" reference in the schema.prisma doc comment)
-- because SQL Server's unique index/constraint treats multiple NULLs as
-- duplicates (unlike Postgres), so a plain unique nullable column allowed
-- only one portal-account-less patient per clinic before every later
-- registration 500'd. One-User-per-Patient was instead only a
-- structural/application invariant with no database backstop. A WHERE-
-- filtered unique index sidesteps the multiple-NULLs problem entirely
-- (rows with userId IS NULL are excluded from the index, so they can
-- never collide) while still enforcing true uniqueness for every patient
-- that *does* have a linked portal account.
--
-- Verified against dev data before this change: 0 duplicate non-null
-- Patient.userId values among the 4 existing Patient rows.
--
-- Replaces the old plain, non-unique `patients_userId_idx` — every
-- `where: { userId }` lookup in this codebase (PatientsService.findOwn /
-- findByUserId) already passes a concrete, non-null id, so the filtered
-- unique index serves those lookups just as well while also adding the
-- uniqueness guarantee; keeping both would be a redundant second index on
-- the same column.
DROP INDEX [patients_userId_idx] ON [dbo].[patients];

CREATE UNIQUE NONCLUSTERED INDEX [patients_userId_filtered_uq]
  ON [dbo].[patients] ([userId])
  WHERE [userId] IS NOT NULL;

-- =========================================================================
-- 8. Appointment: queue-workflow indexes
-- =========================================================================
-- Audit finding: AppointmentsService.findQueue and .callNext (the live
-- front-desk/doctor queue, polled frequently) filter by
-- `{ clinicId, status, startsAt: <today's range> }` (optionally
-- `doctorId`), which none of the existing Appointment indexes
-- ([clinicId, doctorId, startsAt], [clinicId, patientId, startsAt],
-- [clinicId, status]) covers as a single composite lookup — see the
-- schema.prisma doc comment on model Appointment for the exact query
-- shapes these were sized against.
CREATE NONCLUSTERED INDEX [appointments_clinicId_status_startsAt_idx]
  ON [dbo].[appointments] ([clinicId], [status], [startsAt]);

CREATE NONCLUSTERED INDEX [appointments_clinicId_doctorId_status_startsAt_idx]
  ON [dbo].[appointments] ([clinicId], [doctorId], [status], [startsAt]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
