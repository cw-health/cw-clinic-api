BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[medicines] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [genericName] NVARCHAR(1000),
    [strength] NVARCHAR(1000),
    [form] NVARCHAR(30),
    [manufacturer] NVARCHAR(1000),
    [notes] NVARCHAR(500),
    [isActive] BIT NOT NULL CONSTRAINT [medicines_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [medicines_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [medicines_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [medicines_clinicId_name_strength_key] UNIQUE NONCLUSTERED ([clinicId],[name],[strength])
);

-- CreateTable
CREATE TABLE [dbo].[prescriptions] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [consultationId] NVARCHAR(1000) NOT NULL,
    [doctorId] NVARCHAR(1000) NOT NULL,
    [patientId] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [prescriptions_status_df] DEFAULT 'DRAFT',
    [version] INT NOT NULL CONSTRAINT [prescriptions_version_df] DEFAULT 1,
    [notes] NVARCHAR(1000),
    [createdByUserId] NVARCHAR(1000) NOT NULL,
    [finalizedAt] DATETIME2,
    [supersededAt] DATETIME2,
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [prescriptions_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    [amendsId] NVARCHAR(1000),
    CONSTRAINT [prescriptions_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [prescriptions_amendsId_key] UNIQUE NONCLUSTERED ([amendsId])
);

-- CreateTable
CREATE TABLE [dbo].[prescription_items] (
    [id] NVARCHAR(1000) NOT NULL,
    [prescriptionId] NVARCHAR(1000) NOT NULL,
    [medicineId] NVARCHAR(1000) NOT NULL,
    [medicineName] NVARCHAR(1000) NOT NULL,
    [dosage] NVARCHAR(100) NOT NULL,
    [frequency] NVARCHAR(100) NOT NULL,
    [duration] NVARCHAR(100) NOT NULL,
    [route] NVARCHAR(50),
    [instructions] NVARCHAR(500),
    [sortOrder] INT NOT NULL CONSTRAINT [prescription_items_sortOrder_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [prescription_items_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [prescription_items_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [medicines_clinicId_isActive_idx] ON [dbo].[medicines]([clinicId], [isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [medicines_clinicId_name_idx] ON [dbo].[medicines]([clinicId], [name]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [prescriptions_clinicId_consultationId_createdAt_idx] ON [dbo].[prescriptions]([clinicId], [consultationId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [prescriptions_clinicId_patientId_createdAt_idx] ON [dbo].[prescriptions]([clinicId], [patientId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [prescriptions_clinicId_doctorId_createdAt_idx] ON [dbo].[prescriptions]([clinicId], [doctorId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [prescription_items_prescriptionId_idx] ON [dbo].[prescription_items]([prescriptionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [prescription_items_medicineId_idx] ON [dbo].[prescription_items]([medicineId]);

-- AddForeignKey
ALTER TABLE [dbo].[prescriptions] ADD CONSTRAINT [prescriptions_consultationId_fkey] FOREIGN KEY ([consultationId]) REFERENCES [dbo].[consultations]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[prescriptions] ADD CONSTRAINT [prescriptions_doctorId_fkey] FOREIGN KEY ([doctorId]) REFERENCES [dbo].[doctors]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[prescriptions] ADD CONSTRAINT [prescriptions_patientId_fkey] FOREIGN KEY ([patientId]) REFERENCES [dbo].[patients]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[prescriptions] ADD CONSTRAINT [prescriptions_amendsId_fkey] FOREIGN KEY ([amendsId]) REFERENCES [dbo].[prescriptions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[prescription_items] ADD CONSTRAINT [prescription_items_prescriptionId_fkey] FOREIGN KEY ([prescriptionId]) REFERENCES [dbo].[prescriptions]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[prescription_items] ADD CONSTRAINT [prescription_items_medicineId_fkey] FOREIGN KEY ([medicineId]) REFERENCES [dbo].[medicines]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

