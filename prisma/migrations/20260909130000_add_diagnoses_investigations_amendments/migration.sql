-- Consultation clinical-record upgrade (2026-09-09): three new,
-- purely-additive tables — `diagnoses`, `investigation_orders`,
-- `consultation_amendments`. See the doc comments on `model Diagnosis`,
-- `model InvestigationOrder`, `model ConsultationAmendment` in
-- schema.prisma, and docs/DATABASE.md §16, for the full rationale. No
-- existing table, column, or index is touched.

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[diagnoses] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [consultationId] NVARCHAR(1000) NOT NULL,
    [doctorId] NVARCHAR(1000) NOT NULL,
    [type] NVARCHAR(20) NOT NULL,
    [description] NVARCHAR(500) NOT NULL,
    [icdCode] NVARCHAR(20),
    [sortOrder] INT NOT NULL CONSTRAINT [diagnoses_sortOrder_df] DEFAULT 0,
    [createdByUserId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [diagnoses_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [diagnoses_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [diagnoses_clinicId_consultationId_sortOrder_idx] ON [dbo].[diagnoses]([clinicId], [consultationId], [sortOrder]);

-- AddForeignKey
ALTER TABLE [dbo].[diagnoses] ADD CONSTRAINT [diagnoses_consultationId_fkey] FOREIGN KEY ([consultationId]) REFERENCES [dbo].[consultations]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CreateTable
CREATE TABLE [dbo].[investigation_orders] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [consultationId] NVARCHAR(1000) NOT NULL,
    [doctorId] NVARCHAR(1000) NOT NULL,
    [testName] NVARCHAR(200) NOT NULL,
    [category] NVARCHAR(50),
    [priority] NVARCHAR(20) NOT NULL CONSTRAINT [investigation_orders_priority_df] DEFAULT 'ROUTINE',
    [clinicalNotes] NVARCHAR(500),
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [investigation_orders_status_df] DEFAULT 'ORDERED',
    [createdByUserId] NVARCHAR(1000) NOT NULL,
    [cancelledAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [investigation_orders_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [investigation_orders_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [investigation_orders_clinicId_consultationId_createdAt_idx] ON [dbo].[investigation_orders]([clinicId], [consultationId], [createdAt]);

-- AddForeignKey
ALTER TABLE [dbo].[investigation_orders] ADD CONSTRAINT [investigation_orders_consultationId_fkey] FOREIGN KEY ([consultationId]) REFERENCES [dbo].[consultations]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CreateTable
CREATE TABLE [dbo].[consultation_amendments] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [consultationId] NVARCHAR(1000) NOT NULL,
    [amendedByUserId] NVARCHAR(1000) NOT NULL,
    [reason] NVARCHAR(500) NOT NULL,
    [changedFields] NVARCHAR(500) NOT NULL,
    [previousValues] NVARCHAR(4000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [consultation_amendments_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [consultation_amendments_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [consultation_amendments_clinicId_consultationId_createdAt_idx] ON [dbo].[consultation_amendments]([clinicId], [consultationId], [createdAt]);

-- AddForeignKey
ALTER TABLE [dbo].[consultation_amendments] ADD CONSTRAINT [consultation_amendments_consultationId_fkey] FOREIGN KEY ([consultationId]) REFERENCES [dbo].[consultations]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
