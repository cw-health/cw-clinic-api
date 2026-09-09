BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[clinics] ADD [alternatePhone] NVARCHAR(1000),
[description] NVARCHAR(1000),
[legalEntityType] NVARCHAR(30),
[legalName] NVARCHAR(1000),
[onboardingCompletedAt] DATETIME2,
[onboardingStatus] NVARCHAR(20) NOT NULL CONSTRAINT [clinics_onboardingStatus_df] DEFAULT 'NOT_STARTED',
[primaryAdminUserId] NVARCHAR(1000),
[registrationApplicable] BIT NOT NULL CONSTRAINT [clinics_registrationApplicable_df] DEFAULT 1,
[registrationAuthority] NVARCHAR(1000),
[registrationDate] DATE,
[registrationExpiryDate] DATE,
[registrationNumber] NVARCHAR(1000),
[taxIdentifierType] NVARCHAR(1000),
[taxIdentifierValue] NVARCHAR(1000);

-- CreateTable
CREATE TABLE [dbo].[clinic_documents] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [uploadedByUserId] NVARCHAR(1000) NOT NULL,
    [category] NVARCHAR(30) NOT NULL,
    [fileName] NVARCHAR(255) NOT NULL,
    [mimeType] NVARCHAR(100) NOT NULL,
    [sizeBytes] INT NOT NULL,
    [storageKey] NVARCHAR(500) NOT NULL,
    [notes] NVARCHAR(1000),
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [clinic_documents_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [clinic_documents_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [clinic_documents_clinicId_createdAt_idx] ON [dbo].[clinic_documents]([clinicId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [clinics_onboardingStatus_idx] ON [dbo].[clinics]([onboardingStatus]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [clinics_primaryAdminUserId_idx] ON [dbo].[clinics]([primaryAdminUserId]);

-- AddForeignKey
ALTER TABLE [dbo].[clinics] ADD CONSTRAINT [clinics_primaryAdminUserId_fkey] FOREIGN KEY ([primaryAdminUserId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[clinic_documents] ADD CONSTRAINT [clinic_documents_clinicId_fkey] FOREIGN KEY ([clinicId]) REFERENCES [dbo].[clinics]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

