BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[subscriptions] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [planId] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [subscriptions_status_df] DEFAULT 'ACTIVE',
    [currentPeriodStart] DATETIME2 NOT NULL,
    [currentPeriodEnd] DATETIME2 NOT NULL,
    [trialEndsAt] DATETIME2,
    [cancelledAt] DATETIME2,
    [cancellationReason] NVARCHAR(500),
    [supersededAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [subscriptions_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [subscriptions_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [subscriptions_clinicId_createdAt_idx] ON [dbo].[subscriptions]([clinicId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [subscriptions_clinicId_status_idx] ON [dbo].[subscriptions]([clinicId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [subscriptions_planId_idx] ON [dbo].[subscriptions]([planId]);

-- AddForeignKey
ALTER TABLE [dbo].[subscriptions] ADD CONSTRAINT [subscriptions_clinicId_fkey] FOREIGN KEY ([clinicId]) REFERENCES [dbo].[clinics]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[subscriptions] ADD CONSTRAINT [subscriptions_planId_fkey] FOREIGN KEY ([planId]) REFERENCES [dbo].[plans]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
