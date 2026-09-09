BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[notifications] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [type] NVARCHAR(30) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [body] NVARCHAR(1000) NOT NULL,
    [relatedEntityType] NVARCHAR(50),
    [relatedEntityId] NVARCHAR(1000),
    [readAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [notifications_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [notifications_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[documents] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [patientId] NVARCHAR(1000) NOT NULL,
    [uploadedByUserId] NVARCHAR(1000) NOT NULL,
    [category] NVARCHAR(30) NOT NULL,
    [fileName] NVARCHAR(255) NOT NULL,
    [mimeType] NVARCHAR(100) NOT NULL,
    [sizeBytes] INT NOT NULL,
    [storageKey] NVARCHAR(500) NOT NULL,
    [notes] NVARCHAR(1000),
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [documents_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [documents_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [notifications_clinicId_userId_createdAt_idx] ON [dbo].[notifications]([clinicId], [userId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [documents_clinicId_patientId_createdAt_idx] ON [dbo].[documents]([clinicId], [patientId], [createdAt]);

-- AddForeignKey
ALTER TABLE [dbo].[documents] ADD CONSTRAINT [documents_patientId_fkey] FOREIGN KEY ([patientId]) REFERENCES [dbo].[patients]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

