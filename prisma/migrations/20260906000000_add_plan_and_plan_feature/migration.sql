BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[plans] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(1000),
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [plans_status_df] DEFAULT 'ACTIVE',
    [price] DECIMAL(10,2) NOT NULL,
    [currency] NVARCHAR(3) NOT NULL CONSTRAINT [plans_currency_df] DEFAULT 'INR',
    [billingInterval] NVARCHAR(20) NOT NULL,
    [maxDoctors] INT,
    [maxStaff] INT,
    [maxPatients] INT,
    [maxBranches] INT,
    [trialDays] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [plans_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [plans_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [plans_name_key] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[plan_features] (
    [id] NVARCHAR(1000) NOT NULL,
    [planId] NVARCHAR(1000) NOT NULL,
    [key] NVARCHAR(50) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [plan_features_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [plan_features_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [plan_features_planId_key_key] UNIQUE NONCLUSTERED ([planId],[key])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [plans_status_idx] ON [dbo].[plans]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [plan_features_key_idx] ON [dbo].[plan_features]([key]);

-- AddForeignKey
ALTER TABLE [dbo].[plan_features] ADD CONSTRAINT [plan_features_planId_fkey] FOREIGN KEY ([planId]) REFERENCES [dbo].[plans]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
