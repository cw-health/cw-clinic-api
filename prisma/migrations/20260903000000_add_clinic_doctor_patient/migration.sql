BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[clinics] ADD [addressLine1] NVARCHAR(1000),
[addressLine2] NVARCHAR(1000),
[city] NVARCHAR(1000),
[contactEmail] NVARCHAR(1000),
[contactPhone] NVARCHAR(1000),
[country] NVARCHAR(1000),
[defaultAppointmentDurationMinutes] INT NOT NULL CONSTRAINT [clinics_defaultAppointmentDurationMinutes_df] DEFAULT 15,
[postalCode] NVARCHAR(1000),
[state] NVARCHAR(1000),
[timezone] NVARCHAR(1000) NOT NULL CONSTRAINT [clinics_timezone_df] DEFAULT 'UTC',
[website] NVARCHAR(1000);

-- CreateTable
CREATE TABLE [dbo].[clinic_working_hours] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [dayOfWeek] INT NOT NULL,
    [isOpen] BIT NOT NULL CONSTRAINT [clinic_working_hours_isOpen_df] DEFAULT 1,
    [openTime] NVARCHAR(5),
    [closeTime] NVARCHAR(5),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [clinic_working_hours_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [clinic_working_hours_clinicId_dayOfWeek_key] UNIQUE NONCLUSTERED ([clinicId],[dayOfWeek])
);

-- CreateTable
CREATE TABLE [dbo].[clinic_holidays] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [date] DATE NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [clinic_holidays_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [clinic_holidays_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [clinic_holidays_clinicId_date_key] UNIQUE NONCLUSTERED ([clinicId],[date])
);

-- CreateTable
CREATE TABLE [dbo].[specializations] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [specializations_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [specializations_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [specializations_name_key] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[doctor_specializations] (
    [id] NVARCHAR(1000) NOT NULL,
    [doctorId] NVARCHAR(1000) NOT NULL,
    [specializationId] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [doctor_specializations_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [doctor_specializations_doctorId_specializationId_key] UNIQUE NONCLUSTERED ([doctorId],[specializationId])
);

-- CreateTable
CREATE TABLE [dbo].[doctors] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [licenseNumber] NVARCHAR(1000),
    [qualification] NVARCHAR(1000),
    [bio] NVARCHAR(2000),
    [phone] NVARCHAR(1000),
    [consultationFee] DECIMAL(10,2),
    [yearsOfExperience] INT,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [doctors_status_df] DEFAULT 'ACTIVE',
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [doctors_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [doctors_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [doctors_userId_key] UNIQUE NONCLUSTERED ([userId])
);

-- CreateTable
CREATE TABLE [dbo].[doctor_availability] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [doctorId] NVARCHAR(1000) NOT NULL,
    [dayOfWeek] INT NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [doctor_availability_isActive_df] DEFAULT 1,
    [startTime] NVARCHAR(5) NOT NULL,
    [endTime] NVARCHAR(5) NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [doctor_availability_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [doctor_availability_doctorId_dayOfWeek_key] UNIQUE NONCLUSTERED ([doctorId],[dayOfWeek])
);

-- CreateTable
CREATE TABLE [dbo].[patients] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000),
    [mrn] NVARCHAR(1000) NOT NULL,
    [firstName] NVARCHAR(1000) NOT NULL,
    [lastName] NVARCHAR(1000) NOT NULL,
    [gender] NVARCHAR(20),
    [dateOfBirth] DATE,
    [phone] NVARCHAR(1000),
    [email] NVARCHAR(1000),
    [addressLine1] NVARCHAR(1000),
    [addressLine2] NVARCHAR(1000),
    [city] NVARCHAR(1000),
    [state] NVARCHAR(1000),
    [postalCode] NVARCHAR(1000),
    [country] NVARCHAR(1000),
    [emergencyContactName] NVARCHAR(1000),
    [emergencyContactPhone] NVARCHAR(1000),
    [knownAllergies] NVARCHAR(1000),
    [chronicConditions] NVARCHAR(1000),
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [patients_status_df] DEFAULT 'ACTIVE',
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [patients_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [patients_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [patients_userId_key] UNIQUE NONCLUSTERED ([userId]),
    CONSTRAINT [patients_clinicId_mrn_key] UNIQUE NONCLUSTERED ([clinicId],[mrn])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [clinic_holidays_clinicId_date_idx] ON [dbo].[clinic_holidays]([clinicId], [date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [doctor_specializations_specializationId_idx] ON [dbo].[doctor_specializations]([specializationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [doctors_clinicId_status_idx] ON [dbo].[doctors]([clinicId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [doctors_clinicId_createdAt_idx] ON [dbo].[doctors]([clinicId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [doctor_availability_clinicId_doctorId_idx] ON [dbo].[doctor_availability]([clinicId], [doctorId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [patients_clinicId_status_idx] ON [dbo].[patients]([clinicId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [patients_clinicId_lastName_firstName_idx] ON [dbo].[patients]([clinicId], [lastName], [firstName]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [patients_clinicId_phone_idx] ON [dbo].[patients]([clinicId], [phone]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [patients_clinicId_createdAt_idx] ON [dbo].[patients]([clinicId], [createdAt]);

-- AddForeignKey
ALTER TABLE [dbo].[clinic_working_hours] ADD CONSTRAINT [clinic_working_hours_clinicId_fkey] FOREIGN KEY ([clinicId]) REFERENCES [dbo].[clinics]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[clinic_holidays] ADD CONSTRAINT [clinic_holidays_clinicId_fkey] FOREIGN KEY ([clinicId]) REFERENCES [dbo].[clinics]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[doctor_specializations] ADD CONSTRAINT [doctor_specializations_doctorId_fkey] FOREIGN KEY ([doctorId]) REFERENCES [dbo].[doctors]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[doctor_specializations] ADD CONSTRAINT [doctor_specializations_specializationId_fkey] FOREIGN KEY ([specializationId]) REFERENCES [dbo].[specializations]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[doctors] ADD CONSTRAINT [doctors_clinicId_fkey] FOREIGN KEY ([clinicId]) REFERENCES [dbo].[clinics]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[doctors] ADD CONSTRAINT [doctors_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[doctor_availability] ADD CONSTRAINT [doctor_availability_doctorId_fkey] FOREIGN KEY ([doctorId]) REFERENCES [dbo].[doctors]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[patients] ADD CONSTRAINT [patients_clinicId_fkey] FOREIGN KEY ([clinicId]) REFERENCES [dbo].[clinics]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[patients] ADD CONSTRAINT [patients_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

