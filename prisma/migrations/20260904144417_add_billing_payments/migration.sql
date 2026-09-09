BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[clinics] ADD [invoiceSequence] INT NOT NULL CONSTRAINT [clinics_invoiceSequence_df] DEFAULT 0,
[receiptSequence] INT NOT NULL CONSTRAINT [clinics_receiptSequence_df] DEFAULT 0;

-- CreateTable
CREATE TABLE [dbo].[audit_logs] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [actorUserId] NVARCHAR(1000) NOT NULL,
    [entity] NVARCHAR(1000) NOT NULL,
    [entityId] NVARCHAR(1000) NOT NULL,
    [action] NVARCHAR(1000) NOT NULL,
    [changedFields] NVARCHAR(2000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [audit_logs_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [audit_logs_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[invoices] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [consultationId] NVARCHAR(1000) NOT NULL,
    [doctorId] NVARCHAR(1000) NOT NULL,
    [patientId] NVARCHAR(1000) NOT NULL,
    [invoiceNumber] NVARCHAR(1000),
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [invoices_status_df] DEFAULT 'DRAFT',
    [subtotal] DECIMAL(10,2) NOT NULL CONSTRAINT [invoices_subtotal_df] DEFAULT 0,
    [discountAmount] DECIMAL(10,2) NOT NULL CONSTRAINT [invoices_discountAmount_df] DEFAULT 0,
    [taxAmount] DECIMAL(10,2) NOT NULL CONSTRAINT [invoices_taxAmount_df] DEFAULT 0,
    [totalAmount] DECIMAL(10,2) NOT NULL CONSTRAINT [invoices_totalAmount_df] DEFAULT 0,
    [amountPaid] DECIMAL(10,2) NOT NULL CONSTRAINT [invoices_amountPaid_df] DEFAULT 0,
    [notes] NVARCHAR(1000),
    [createdByUserId] NVARCHAR(1000) NOT NULL,
    [issuedAt] DATETIME2,
    [dueDate] DATE,
    [voidedAt] DATETIME2,
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [invoices_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [invoices_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [invoices_clinicId_invoiceNumber_key] UNIQUE NONCLUSTERED ([clinicId],[invoiceNumber])
);

-- CreateTable
CREATE TABLE [dbo].[invoice_items] (
    [id] NVARCHAR(1000) NOT NULL,
    [invoiceId] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(500) NOT NULL,
    [itemType] NVARCHAR(20) NOT NULL CONSTRAINT [invoice_items_itemType_df] DEFAULT 'OTHER',
    [quantity] INT NOT NULL CONSTRAINT [invoice_items_quantity_df] DEFAULT 1,
    [unitPrice] DECIMAL(10,2) NOT NULL,
    [discountAmount] DECIMAL(10,2) NOT NULL CONSTRAINT [invoice_items_discountAmount_df] DEFAULT 0,
    [taxRatePercent] DECIMAL(5,2) NOT NULL CONSTRAINT [invoice_items_taxRatePercent_df] DEFAULT 0,
    [lineTotal] DECIMAL(10,2) NOT NULL,
    [sortOrder] INT NOT NULL CONSTRAINT [invoice_items_sortOrder_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [invoice_items_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [invoice_items_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[payments] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [invoiceId] NVARCHAR(1000) NOT NULL,
    [amount] DECIMAL(10,2) NOT NULL,
    [method] NVARCHAR(20) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [payments_status_df] DEFAULT 'PENDING',
    [providerReference] NVARCHAR(1000),
    [receiptNumber] NVARCHAR(1000),
    [receivedByUserId] NVARCHAR(1000) NOT NULL,
    [paidAt] DATETIME2,
    [notes] NVARCHAR(500),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [payments_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [payments_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [payments_clinicId_receiptNumber_key] UNIQUE NONCLUSTERED ([clinicId],[receiptNumber])
);

-- CreateTable
CREATE TABLE [dbo].[refunds] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [paymentId] NVARCHAR(1000) NOT NULL,
    [amount] DECIMAL(10,2) NOT NULL,
    [reason] NVARCHAR(500) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [refunds_status_df] DEFAULT 'COMPLETED',
    [processedByUserId] NVARCHAR(1000) NOT NULL,
    [processedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [refunds_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [refunds_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [audit_logs_clinicId_entity_entityId_idx] ON [dbo].[audit_logs]([clinicId], [entity], [entityId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [audit_logs_clinicId_createdAt_idx] ON [dbo].[audit_logs]([clinicId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [invoices_clinicId_consultationId_idx] ON [dbo].[invoices]([clinicId], [consultationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [invoices_clinicId_patientId_createdAt_idx] ON [dbo].[invoices]([clinicId], [patientId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [invoices_clinicId_doctorId_createdAt_idx] ON [dbo].[invoices]([clinicId], [doctorId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [invoices_clinicId_status_idx] ON [dbo].[invoices]([clinicId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [invoice_items_invoiceId_idx] ON [dbo].[invoice_items]([invoiceId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [payments_clinicId_invoiceId_idx] ON [dbo].[payments]([clinicId], [invoiceId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [payments_clinicId_status_idx] ON [dbo].[payments]([clinicId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [refunds_clinicId_paymentId_idx] ON [dbo].[refunds]([clinicId], [paymentId]);

-- AddForeignKey
ALTER TABLE [dbo].[invoices] ADD CONSTRAINT [invoices_consultationId_fkey] FOREIGN KEY ([consultationId]) REFERENCES [dbo].[consultations]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[invoices] ADD CONSTRAINT [invoices_doctorId_fkey] FOREIGN KEY ([doctorId]) REFERENCES [dbo].[doctors]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[invoices] ADD CONSTRAINT [invoices_patientId_fkey] FOREIGN KEY ([patientId]) REFERENCES [dbo].[patients]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[invoice_items] ADD CONSTRAINT [invoice_items_invoiceId_fkey] FOREIGN KEY ([invoiceId]) REFERENCES [dbo].[invoices]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[payments] ADD CONSTRAINT [payments_invoiceId_fkey] FOREIGN KEY ([invoiceId]) REFERENCES [dbo].[invoices]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[refunds] ADD CONSTRAINT [refunds_paymentId_fkey] FOREIGN KEY ([paymentId]) REFERENCES [dbo].[payments]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

