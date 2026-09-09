BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[clinic_memberships] ADD [branchId] NVARCHAR(1000),
[departmentId] NVARCHAR(1000);

-- CreateTable
CREATE TABLE [dbo].[staff_invitations] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [tokenHash] NVARCHAR(1000) NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [acceptedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [staff_invitations_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [staff_invitations_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [staff_invitations_userId_key] UNIQUE NONCLUSTERED ([userId]),
    CONSTRAINT [staff_invitations_tokenHash_key] UNIQUE NONCLUSTERED ([tokenHash])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [clinic_memberships_branchId_idx] ON [dbo].[clinic_memberships]([branchId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [clinic_memberships_departmentId_idx] ON [dbo].[clinic_memberships]([departmentId]);

-- AddForeignKey
ALTER TABLE [dbo].[clinic_memberships] ADD CONSTRAINT [clinic_memberships_branchId_fkey] FOREIGN KEY ([branchId]) REFERENCES [dbo].[branches]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[clinic_memberships] ADD CONSTRAINT [clinic_memberships_departmentId_fkey] FOREIGN KEY ([departmentId]) REFERENCES [dbo].[departments]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[staff_invitations] ADD CONSTRAINT [staff_invitations_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
