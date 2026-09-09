BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[password_reset_tokens] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [tokenHash] NVARCHAR(1000) NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [usedAt] DATETIME2,
    [createdByIp] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [password_reset_tokens_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [password_reset_tokens_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [password_reset_tokens_userId_key] UNIQUE NONCLUSTERED ([userId]),
    CONSTRAINT [password_reset_tokens_tokenHash_key] UNIQUE NONCLUSTERED ([tokenHash])
);

-- AddForeignKey
ALTER TABLE [dbo].[password_reset_tokens] ADD CONSTRAINT [password_reset_tokens_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
