BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[doctors] ADD [appointmentDurationMinutes] INT;

-- CreateTable
CREATE TABLE [dbo].[doctor_breaks] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [doctorId] NVARCHAR(1000) NOT NULL,
    [dayOfWeek] INT NOT NULL,
    [startTime] NVARCHAR(5) NOT NULL,
    [endTime] NVARCHAR(5) NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [doctor_breaks_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[doctor_unavailability] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [doctorId] NVARCHAR(1000) NOT NULL,
    [startsAt] DATETIME2 NOT NULL,
    [endsAt] DATETIME2 NOT NULL,
    [reason] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [doctor_unavailability_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [doctor_unavailability_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[appointments] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [doctorId] NVARCHAR(1000) NOT NULL,
    [patientId] NVARCHAR(1000) NOT NULL,
    [startsAt] DATETIME2 NOT NULL,
    [endsAt] DATETIME2 NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [appointments_status_df] DEFAULT 'SCHEDULED',
    [reasonForVisit] NVARCHAR(500),
    [notes] NVARCHAR(1000),
    [createdByUserId] NVARCHAR(1000) NOT NULL,
    [confirmedAt] DATETIME2,
    [checkedInAt] DATETIME2,
    [consultationStartedAt] DATETIME2,
    [completedAt] DATETIME2,
    [noShowAt] DATETIME2,
    [cancelledAt] DATETIME2,
    [cancelledByUserId] NVARCHAR(1000),
    [cancellationReason] NVARCHAR(500),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [appointments_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [appointments_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [doctor_breaks_clinicId_doctorId_idx] ON [dbo].[doctor_breaks]([clinicId], [doctorId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [doctor_unavailability_clinicId_doctorId_startsAt_idx] ON [dbo].[doctor_unavailability]([clinicId], [doctorId], [startsAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [appointments_clinicId_doctorId_startsAt_idx] ON [dbo].[appointments]([clinicId], [doctorId], [startsAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [appointments_clinicId_patientId_startsAt_idx] ON [dbo].[appointments]([clinicId], [patientId], [startsAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [appointments_clinicId_status_idx] ON [dbo].[appointments]([clinicId], [status]);

-- AddForeignKey
ALTER TABLE [dbo].[doctor_breaks] ADD CONSTRAINT [doctor_breaks_doctorId_fkey] FOREIGN KEY ([doctorId]) REFERENCES [dbo].[doctors]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[doctor_unavailability] ADD CONSTRAINT [doctor_unavailability_doctorId_fkey] FOREIGN KEY ([doctorId]) REFERENCES [dbo].[doctors]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[appointments] ADD CONSTRAINT [appointments_doctorId_fkey] FOREIGN KEY ([doctorId]) REFERENCES [dbo].[doctors]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[appointments] ADD CONSTRAINT [appointments_patientId_fkey] FOREIGN KEY ([patientId]) REFERENCES [dbo].[patients]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

