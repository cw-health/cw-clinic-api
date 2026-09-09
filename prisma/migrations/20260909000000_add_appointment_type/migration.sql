-- Adds Appointment.type (WALK_IN / SCHEDULED / FOLLOW_UP), defaulting every
-- existing row to 'SCHEDULED' — preserves current behavior for all
-- appointments booked before this migration.
ALTER TABLE [dbo].[appointments] ADD [type] NVARCHAR(20) NOT NULL CONSTRAINT [appointments_type_df] DEFAULT 'SCHEDULED';
