BEGIN TRY

BEGIN TRAN;

-- DropIndex
ALTER TABLE [dbo].[patients] DROP CONSTRAINT [patients_userId_key];

-- CreateIndex
CREATE NONCLUSTERED INDEX [patients_userId_idx] ON [dbo].[patients]([userId]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

