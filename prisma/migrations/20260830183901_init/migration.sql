BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[clinics] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [slug] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [clinics_status_df] DEFAULT 'ACTIVE',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [clinics_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [clinics_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [clinics_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[users] (
    [id] NVARCHAR(1000) NOT NULL,
    [email] NVARCHAR(1000) NOT NULL,
    [passwordHash] NVARCHAR(1000) NOT NULL,
    [firstName] NVARCHAR(1000) NOT NULL,
    [lastName] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [users_status_df] DEFAULT 'PENDING',
    [isSuperAdmin] BIT NOT NULL CONSTRAINT [users_isSuperAdmin_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [users_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [users_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [users_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[roles] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000),
    [name] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(1000),
    [isSystem] BIT NOT NULL CONSTRAINT [roles_isSystem_df] DEFAULT 0,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [roles_status_df] DEFAULT 'ACTIVE',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [roles_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [roles_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[permissions] (
    [id] NVARCHAR(1000) NOT NULL,
    [key] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(1000) NOT NULL,
    [category] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [permissions_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [permissions_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [permissions_key_key] UNIQUE NONCLUSTERED ([key])
);

-- CreateTable
CREATE TABLE [dbo].[role_permissions] (
    [id] NVARCHAR(1000) NOT NULL,
    [roleId] NVARCHAR(1000) NOT NULL,
    [permissionId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [role_permissions_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [role_permissions_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [role_permissions_roleId_permissionId_key] UNIQUE NONCLUSTERED ([roleId],[permissionId])
);

-- CreateTable
CREATE TABLE [dbo].[clinic_memberships] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [roleId] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [clinic_memberships_status_df] DEFAULT 'ACTIVE',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [clinic_memberships_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [clinic_memberships_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [clinic_memberships_userId_clinicId_key] UNIQUE NONCLUSTERED ([userId],[clinicId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [clinics_status_idx] ON [dbo].[clinics]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [users_status_idx] ON [dbo].[users]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [roles_clinicId_status_idx] ON [dbo].[roles]([clinicId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [roles_clinicId_name_idx] ON [dbo].[roles]([clinicId], [name]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [permissions_category_idx] ON [dbo].[permissions]([category]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [role_permissions_permissionId_idx] ON [dbo].[role_permissions]([permissionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [clinic_memberships_clinicId_status_idx] ON [dbo].[clinic_memberships]([clinicId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [clinic_memberships_roleId_idx] ON [dbo].[clinic_memberships]([roleId]);

-- AddForeignKey
ALTER TABLE [dbo].[roles] ADD CONSTRAINT [roles_clinicId_fkey] FOREIGN KEY ([clinicId]) REFERENCES [dbo].[clinics]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[role_permissions] ADD CONSTRAINT [role_permissions_roleId_fkey] FOREIGN KEY ([roleId]) REFERENCES [dbo].[roles]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[role_permissions] ADD CONSTRAINT [role_permissions_permissionId_fkey] FOREIGN KEY ([permissionId]) REFERENCES [dbo].[permissions]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[clinic_memberships] ADD CONSTRAINT [clinic_memberships_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[clinic_memberships] ADD CONSTRAINT [clinic_memberships_clinicId_fkey] FOREIGN KEY ([clinicId]) REFERENCES [dbo].[clinics]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[clinic_memberships] ADD CONSTRAINT [clinic_memberships_roleId_fkey] FOREIGN KEY ([roleId]) REFERENCES [dbo].[roles]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
