BEGIN TRY

BEGIN TRAN;

-- AlterTable
-- clinicId becomes nullable to represent a platform-level audit action (no
-- owning clinic, e.g. a clinic being created). actorType is added to
-- distinguish TENANT_USER (clinicId populated) from PLATFORM_USER
-- (clinicId null) audit rows. Every existing row was written by
-- billing/documents, both clinic-scoped write paths, so backfilling
-- actorType = 'TENANT_USER' for pre-existing rows reflects their actual
-- origin rather than inventing history.
ALTER TABLE [dbo].[audit_logs] ADD [actorType] NVARCHAR(20) NOT NULL CONSTRAINT [audit_logs_actorType_df] DEFAULT 'TENANT_USER';

ALTER TABLE [dbo].[audit_logs] ALTER COLUMN [clinicId] NVARCHAR(1000) NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
