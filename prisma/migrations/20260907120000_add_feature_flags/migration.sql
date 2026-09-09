BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[feature_flags] (
    [id] NVARCHAR(1000) NOT NULL,
    [key] NVARCHAR(100) NOT NULL,
    [name] NVARCHAR(150) NOT NULL,
    [description] NVARCHAR(1000),
    [enabled] BIT NOT NULL CONSTRAINT [feature_flags_enabled_df] DEFAULT 0,
    [scope] NVARCHAR(20) NOT NULL CONSTRAINT [feature_flags_scope_df] DEFAULT 'GLOBAL',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [feature_flags_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [feature_flags_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [feature_flags_key_key] UNIQUE NONCLUSTERED ([key])
);

-- CreateTable
CREATE TABLE [dbo].[feature_flag_overrides] (
    [id] NVARCHAR(1000) NOT NULL,
    [flagId] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [enabled] BIT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [feature_flag_overrides_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [feature_flag_overrides_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [feature_flag_overrides_flagId_clinicId_key] UNIQUE NONCLUSTERED ([flagId],[clinicId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [feature_flags_scope_idx] ON [dbo].[feature_flags]([scope]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [feature_flag_overrides_clinicId_idx] ON [dbo].[feature_flag_overrides]([clinicId]);

-- AddForeignKey
ALTER TABLE [dbo].[feature_flag_overrides] ADD CONSTRAINT [feature_flag_overrides_flagId_fkey] FOREIGN KEY ([flagId]) REFERENCES [dbo].[feature_flags]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[feature_flag_overrides] ADD CONSTRAINT [feature_flag_overrides_clinicId_fkey] FOREIGN KEY ([clinicId]) REFERENCES [dbo].[clinics]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
