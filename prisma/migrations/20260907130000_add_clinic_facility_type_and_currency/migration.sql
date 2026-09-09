BEGIN TRY

BEGIN TRAN;

-- AlterTable: Clinic — Phase 1A onboarding. Both columns are additive and
-- safe for existing rows: `facilityType` is nullable (no backfill needed),
-- `currency` carries a DEFAULT so every existing row gets 'INR' with no
-- data loss and no application code change required to keep working.
ALTER TABLE [dbo].[clinics] ADD [facilityType] NVARCHAR(30);

ALTER TABLE [dbo].[clinics] ADD [currency] NVARCHAR(3) NOT NULL CONSTRAINT [clinics_currency_df] DEFAULT 'INR';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
