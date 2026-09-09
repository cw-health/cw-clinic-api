BEGIN TRY

BEGIN TRAN;

-- AlterTable
-- Additive, nullable columns only — no existing invoice_items row is
-- touched or rewritten. Schema-only prep for a future prescription/lab-
-- order -> invoice-item linkage (docs/DATABASE.md §18); no service logic
-- reads or writes these columns yet.
ALTER TABLE [dbo].[invoice_items] ADD [prescriptionId] NVARCHAR(1000),
[investigationOrderId] NVARCHAR(1000);

-- CreateIndex
CREATE NONCLUSTERED INDEX [invoice_items_prescriptionId_idx] ON [dbo].[invoice_items]([prescriptionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [invoice_items_investigationOrderId_idx] ON [dbo].[invoice_items]([investigationOrderId]);

-- AddForeignKey
ALTER TABLE [dbo].[invoice_items] ADD CONSTRAINT [invoice_items_prescriptionId_fkey] FOREIGN KEY ([prescriptionId]) REFERENCES [dbo].[prescriptions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[invoice_items] ADD CONSTRAINT [invoice_items_investigationOrderId_fkey] FOREIGN KEY ([investigationOrderId]) REFERENCES [dbo].[investigation_orders]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
