BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[audit_logs] ADD [ipAddress] NVARCHAR(64),
[requestId] NVARCHAR(100),
[userAgent] NVARCHAR(255);

-- CreateIndex
CREATE NONCLUSTERED INDEX [audit_logs_actorUserId_idx] ON [dbo].[audit_logs]([actorUserId]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
