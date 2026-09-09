-- Queue upgrade (2026-09-09, docs/DECISIONS.md): introduces `queue_entries`,
-- today's operational queue — token number, position (computed, not
-- stored), and the WAITING/CALLED/IN_CONSULTATION/COMPLETED/SKIPPED/
-- NO_SHOW states that have no equivalent on `appointments.status`. See the
-- doc comment on `model QueueEntry` in schema.prisma for the full
-- rationale. Pure additive migration — a new table and one new foreign
-- key on it; no existing table, column, or index is touched.

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[queue_entries] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [doctorId] NVARCHAR(1000) NOT NULL,
    [appointmentId] NVARCHAR(1000) NOT NULL,
    [queueDate] DATETIME2 NOT NULL,
    [tokenNumber] INT NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [queue_entries_status_df] DEFAULT 'WAITING',
    [calledAt] DATETIME2,
    [calledCount] INT NOT NULL CONSTRAINT [queue_entries_calledCount_df] DEFAULT 0,
    [consultationStartedAt] DATETIME2,
    [completedAt] DATETIME2,
    [skippedAt] DATETIME2,
    [noShowAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [queue_entries_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [queue_entries_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [queue_entries_appointmentId_key] UNIQUE NONCLUSTERED ([appointmentId]),
    CONSTRAINT [queue_entries_clinicId_doctorId_queueDate_tokenNumber_key] UNIQUE NONCLUSTERED ([clinicId],[doctorId],[queueDate],[tokenNumber])
);

-- CreateIndex
-- Doctor-scoped "today's queue" (GET /queue/me, and every call-next/
-- recall/skip/start/complete candidate lookup) — QueueService's
-- where-clauses always lead with these four columns.
CREATE NONCLUSTERED INDEX [queue_entries_clinicId_doctorId_queueDate_status_idx] ON [dbo].[queue_entries]([clinicId], [doctorId], [queueDate], [status]);

-- CreateIndex
-- Clinic-wide "today's queue" (GET /queue, front-desk board view).
CREATE NONCLUSTERED INDEX [queue_entries_clinicId_queueDate_status_idx] ON [dbo].[queue_entries]([clinicId], [queueDate], [status]);

-- AddForeignKey
ALTER TABLE [dbo].[queue_entries] ADD CONSTRAINT [queue_entries_doctorId_fkey] FOREIGN KEY ([doctorId]) REFERENCES [dbo].[doctors]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[queue_entries] ADD CONSTRAINT [queue_entries_appointmentId_fkey] FOREIGN KEY ([appointmentId]) REFERENCES [dbo].[appointments]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
