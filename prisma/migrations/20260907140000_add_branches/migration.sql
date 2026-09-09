BEGIN TRY

BEGIN TRAN;

-- CreateTable: Branch (Phase 1B — Branch Management, docs/DECISIONS.md
-- ADR-009). Purely additive: no existing table is touched, no column is
-- added to Doctor/Patient/Appointment/etc, so every existing single-branch
-- clinic keeps working unchanged — see ADR-009 "Migration strategy".
CREATE TABLE [dbo].[branches] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [code] NVARCHAR(20) NOT NULL,
    [phone] NVARCHAR(1000),
    [email] NVARCHAR(1000),
    [address] NVARCHAR(500),
    [city] NVARCHAR(1000),
    [state] NVARCHAR(1000),
    [postalCode] NVARCHAR(1000),
    [country] NVARCHAR(1000),
    [timezone] NVARCHAR(1000) NOT NULL CONSTRAINT [branches_timezone_df] DEFAULT 'UTC',
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [branches_status_df] DEFAULT 'ACTIVE',
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [branches_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [branches_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [branches_clinicId_code_key] UNIQUE NONCLUSTERED ([clinicId],[code]),
    CONSTRAINT [branches_clinicId_name_key] UNIQUE NONCLUSTERED ([clinicId],[name])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [branches_clinicId_status_idx] ON [dbo].[branches]([clinicId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [branches_clinicId_createdAt_idx] ON [dbo].[branches]([clinicId], [createdAt]);

-- AddForeignKey
ALTER TABLE [dbo].[branches] ADD CONSTRAINT [branches_clinicId_fkey] FOREIGN KEY ([clinicId]) REFERENCES [dbo].[clinics]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
