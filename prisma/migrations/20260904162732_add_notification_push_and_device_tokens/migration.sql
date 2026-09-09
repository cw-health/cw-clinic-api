BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[notifications] ADD [pushAttempts] INT NOT NULL CONSTRAINT [notifications_pushAttempts_df] DEFAULT 0,
[pushLastError] NVARCHAR(500),
[pushSentAt] DATETIME2,
[pushStatus] NVARCHAR(20) NOT NULL CONSTRAINT [notifications_pushStatus_df] DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE [dbo].[user_device_tokens] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [token] NVARCHAR(1000) NOT NULL,
    [platform] NVARCHAR(20) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [user_device_tokens_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [user_device_tokens_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [user_device_tokens_token_key] UNIQUE NONCLUSTERED ([token])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [user_device_tokens_userId_idx] ON [dbo].[user_device_tokens]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [notifications_clinicId_type_relatedEntityId_idx] ON [dbo].[notifications]([clinicId], [type], [relatedEntityId]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
