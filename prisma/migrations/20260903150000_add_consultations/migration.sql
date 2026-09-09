BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[consultations] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [appointmentId] NVARCHAR(1000) NOT NULL,
    [doctorId] NVARCHAR(1000) NOT NULL,
    [patientId] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [consultations_status_df] DEFAULT 'IN_PROGRESS',
    [chiefComplaint] NVARCHAR(1000) NOT NULL,
    [symptoms] NVARCHAR(2000),
    [history] NVARCHAR(2000),
    [heightCm] FLOAT(53),
    [weightKg] FLOAT(53),
    [temperatureCelsius] FLOAT(53),
    [pulseBpm] INT,
    [bloodPressureSystolic] INT,
    [bloodPressureDiastolic] INT,
    [respiratoryRate] INT,
    [spo2Percent] INT,
    [examination] NVARCHAR(2000),
    [diagnosis] NVARCHAR(2000),
    [investigations] NVARCHAR(2000),
    [treatment] NVARCHAR(2000),
    [advice] NVARCHAR(1000),
    [followUpDate] DATE,
    [followUpInstructions] NVARCHAR(500),
    [notes] NVARCHAR(2000),
    [templateKey] NVARCHAR(50),
    [customFields] NVARCHAR(4000),
    [createdByUserId] NVARCHAR(1000) NOT NULL,
    [completedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [consultations_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [consultations_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [consultations_appointmentId_key] UNIQUE NONCLUSTERED ([appointmentId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [consultations_clinicId_patientId_createdAt_idx] ON [dbo].[consultations]([clinicId], [patientId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [consultations_clinicId_doctorId_createdAt_idx] ON [dbo].[consultations]([clinicId], [doctorId], [createdAt]);

-- AddForeignKey
ALTER TABLE [dbo].[consultations] ADD CONSTRAINT [consultations_appointmentId_fkey] FOREIGN KEY ([appointmentId]) REFERENCES [dbo].[appointments]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[consultations] ADD CONSTRAINT [consultations_doctorId_fkey] FOREIGN KEY ([doctorId]) REFERENCES [dbo].[doctors]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[consultations] ADD CONSTRAINT [consultations_patientId_fkey] FOREIGN KEY ([patientId]) REFERENCES [dbo].[patients]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

