BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[medicines] ADD [sku] NVARCHAR(50),
[unit] NVARCHAR(20);

-- CreateTable
CREATE TABLE [dbo].[medicine_batches] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [branchId] NVARCHAR(1000),
    [medicineId] NVARCHAR(1000) NOT NULL,
    [batchNumber] NVARCHAR(100) NOT NULL,
    [expiryDate] DATE NOT NULL,
    [quantityReceived] INT NOT NULL,
    [quantityOnHand] INT NOT NULL,
    [purchasePrice] DECIMAL(10,2) NOT NULL,
    [sellingPrice] DECIMAL(10,2) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [medicine_batches_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [medicine_batches_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [medicine_batches_clinicId_medicineId_branchId_batchNumber_key] UNIQUE NONCLUSTERED ([clinicId],[medicineId],[branchId],[batchNumber])
);

-- CreateTable
CREATE TABLE [dbo].[purchase_invoices] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [branchId] NVARCHAR(1000),
    [supplierName] NVARCHAR(200) NOT NULL,
    [invoiceNumber] NVARCHAR(100),
    [purchaseDate] DATE NOT NULL,
    [notes] NVARCHAR(500),
    [createdByUserId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [purchase_invoices_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [purchase_invoices_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[purchase_items] (
    [id] NVARCHAR(1000) NOT NULL,
    [purchaseId] NVARCHAR(1000) NOT NULL,
    [medicineId] NVARCHAR(1000) NOT NULL,
    [medicineName] NVARCHAR(1000) NOT NULL,
    [batchId] NVARCHAR(1000) NOT NULL,
    [batchNumber] NVARCHAR(100) NOT NULL,
    [expiryDate] DATE NOT NULL,
    [quantity] INT NOT NULL,
    [purchasePrice] DECIMAL(10,2) NOT NULL,
    [sellingPrice] DECIMAL(10,2) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [purchase_items_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [purchase_items_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[stock_movements] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [branchId] NVARCHAR(1000),
    [medicineId] NVARCHAR(1000) NOT NULL,
    [batchId] NVARCHAR(1000) NOT NULL,
    [type] NVARCHAR(20) NOT NULL,
    [quantity] INT NOT NULL,
    [quantityBefore] INT NOT NULL,
    [quantityAfter] INT NOT NULL,
    [referenceType] NVARCHAR(30),
    [referenceId] NVARCHAR(1000),
    [reason] NVARCHAR(500),
    [performedByUserId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [stock_movements_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [stock_movements_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[pharmacy_dispenses] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [branchId] NVARCHAR(1000),
    [patientId] NVARCHAR(1000) NOT NULL,
    [prescriptionId] NVARCHAR(1000),
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [pharmacy_dispenses_status_df] DEFAULT 'COMPLETED',
    [dispensedByUserId] NVARCHAR(1000) NOT NULL,
    [dispensedAt] DATETIME2 NOT NULL CONSTRAINT [pharmacy_dispenses_dispensedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [notes] NVARCHAR(500),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [pharmacy_dispenses_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [pharmacy_dispenses_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[pharmacy_dispense_items] (
    [id] NVARCHAR(1000) NOT NULL,
    [dispenseId] NVARCHAR(1000) NOT NULL,
    [medicineId] NVARCHAR(1000) NOT NULL,
    [medicineName] NVARCHAR(1000) NOT NULL,
    [prescriptionItemId] NVARCHAR(1000),
    [quantity] INT NOT NULL,
    [unitPrice] DECIMAL(10,2) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [pharmacy_dispense_items_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [pharmacy_dispense_items_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [medicine_batches_clinicId_medicineId_expiryDate_idx] ON [dbo].[medicine_batches]([clinicId], [medicineId], [expiryDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [medicine_batches_clinicId_branchId_idx] ON [dbo].[medicine_batches]([clinicId], [branchId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [medicine_batches_clinicId_expiryDate_idx] ON [dbo].[medicine_batches]([clinicId], [expiryDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [purchase_invoices_clinicId_purchaseDate_idx] ON [dbo].[purchase_invoices]([clinicId], [purchaseDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [purchase_invoices_clinicId_branchId_idx] ON [dbo].[purchase_invoices]([clinicId], [branchId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [purchase_items_purchaseId_idx] ON [dbo].[purchase_items]([purchaseId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [purchase_items_medicineId_idx] ON [dbo].[purchase_items]([medicineId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [purchase_items_batchId_idx] ON [dbo].[purchase_items]([batchId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [stock_movements_clinicId_medicineId_createdAt_idx] ON [dbo].[stock_movements]([clinicId], [medicineId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [stock_movements_clinicId_batchId_createdAt_idx] ON [dbo].[stock_movements]([clinicId], [batchId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [stock_movements_clinicId_type_createdAt_idx] ON [dbo].[stock_movements]([clinicId], [type], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [stock_movements_clinicId_referenceType_referenceId_idx] ON [dbo].[stock_movements]([clinicId], [referenceType], [referenceId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [pharmacy_dispenses_clinicId_patientId_dispensedAt_idx] ON [dbo].[pharmacy_dispenses]([clinicId], [patientId], [dispensedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [pharmacy_dispenses_clinicId_prescriptionId_idx] ON [dbo].[pharmacy_dispenses]([clinicId], [prescriptionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [pharmacy_dispenses_clinicId_dispensedAt_idx] ON [dbo].[pharmacy_dispenses]([clinicId], [dispensedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [pharmacy_dispense_items_dispenseId_idx] ON [dbo].[pharmacy_dispense_items]([dispenseId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [pharmacy_dispense_items_medicineId_idx] ON [dbo].[pharmacy_dispense_items]([medicineId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [pharmacy_dispense_items_prescriptionItemId_idx] ON [dbo].[pharmacy_dispense_items]([prescriptionItemId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [medicines_clinicId_sku_idx] ON [dbo].[medicines]([clinicId], [sku]);

-- AddForeignKey
ALTER TABLE [dbo].[medicine_batches] ADD CONSTRAINT [medicine_batches_medicineId_fkey] FOREIGN KEY ([medicineId]) REFERENCES [dbo].[medicines]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[medicine_batches] ADD CONSTRAINT [medicine_batches_branchId_fkey] FOREIGN KEY ([branchId]) REFERENCES [dbo].[branches]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[purchase_invoices] ADD CONSTRAINT [purchase_invoices_branchId_fkey] FOREIGN KEY ([branchId]) REFERENCES [dbo].[branches]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[purchase_items] ADD CONSTRAINT [purchase_items_purchaseId_fkey] FOREIGN KEY ([purchaseId]) REFERENCES [dbo].[purchase_invoices]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[purchase_items] ADD CONSTRAINT [purchase_items_medicineId_fkey] FOREIGN KEY ([medicineId]) REFERENCES [dbo].[medicines]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[purchase_items] ADD CONSTRAINT [purchase_items_batchId_fkey] FOREIGN KEY ([batchId]) REFERENCES [dbo].[medicine_batches]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[stock_movements] ADD CONSTRAINT [stock_movements_medicineId_fkey] FOREIGN KEY ([medicineId]) REFERENCES [dbo].[medicines]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[stock_movements] ADD CONSTRAINT [stock_movements_batchId_fkey] FOREIGN KEY ([batchId]) REFERENCES [dbo].[medicine_batches]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[stock_movements] ADD CONSTRAINT [stock_movements_branchId_fkey] FOREIGN KEY ([branchId]) REFERENCES [dbo].[branches]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[pharmacy_dispenses] ADD CONSTRAINT [pharmacy_dispenses_patientId_fkey] FOREIGN KEY ([patientId]) REFERENCES [dbo].[patients]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[pharmacy_dispenses] ADD CONSTRAINT [pharmacy_dispenses_prescriptionId_fkey] FOREIGN KEY ([prescriptionId]) REFERENCES [dbo].[prescriptions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[pharmacy_dispenses] ADD CONSTRAINT [pharmacy_dispenses_branchId_fkey] FOREIGN KEY ([branchId]) REFERENCES [dbo].[branches]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[pharmacy_dispense_items] ADD CONSTRAINT [pharmacy_dispense_items_dispenseId_fkey] FOREIGN KEY ([dispenseId]) REFERENCES [dbo].[pharmacy_dispenses]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[pharmacy_dispense_items] ADD CONSTRAINT [pharmacy_dispense_items_medicineId_fkey] FOREIGN KEY ([medicineId]) REFERENCES [dbo].[medicines]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[pharmacy_dispense_items] ADD CONSTRAINT [pharmacy_dispense_items_prescriptionItemId_fkey] FOREIGN KEY ([prescriptionItemId]) REFERENCES [dbo].[prescription_items]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
