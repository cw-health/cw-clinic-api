BEGIN TRY

BEGIN TRAN;

-- CreateTable: Department (Phase 1C — Department Management). An
-- organizational unit under a Branch (Clinic -> Branch -> Department),
-- distinct from the global Specialization taxonomy. Purely additive: no
-- existing table is touched.
CREATE TABLE [dbo].[departments] (
    [id] NVARCHAR(1000) NOT NULL,
    [clinicId] NVARCHAR(1000) NOT NULL,
    [branchId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [code] NVARCHAR(20) NOT NULL,
    [description] NVARCHAR(500),
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [departments_status_df] DEFAULT 'ACTIVE',
    [deletedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [departments_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [departments_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [departments_branchId_code_key] UNIQUE NONCLUSTERED ([branchId],[code]),
    CONSTRAINT [departments_branchId_name_key] UNIQUE NONCLUSTERED ([branchId],[name])
);

-- CreateTable: DoctorDepartment (Doctor <-> Department many-to-many, mirroring DoctorSpecialization).
CREATE TABLE [dbo].[doctor_departments] (
    [id] NVARCHAR(1000) NOT NULL,
    [doctorId] NVARCHAR(1000) NOT NULL,
    [departmentId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [doctor_departments_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [doctor_departments_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [doctor_departments_doctorId_departmentId_key] UNIQUE NONCLUSTERED ([doctorId],[departmentId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [departments_clinicId_status_idx] ON [dbo].[departments]([clinicId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [departments_clinicId_branchId_idx] ON [dbo].[departments]([clinicId], [branchId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [departments_clinicId_createdAt_idx] ON [dbo].[departments]([clinicId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [doctor_departments_departmentId_idx] ON [dbo].[doctor_departments]([departmentId]);

-- AddForeignKey
ALTER TABLE [dbo].[departments] ADD CONSTRAINT [departments_branchId_fkey] FOREIGN KEY ([branchId]) REFERENCES [dbo].[branches]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[doctor_departments] ADD CONSTRAINT [doctor_departments_doctorId_fkey] FOREIGN KEY ([doctorId]) REFERENCES [dbo].[doctors]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[doctor_departments] ADD CONSTRAINT [doctor_departments_departmentId_fkey] FOREIGN KEY ([departmentId]) REFERENCES [dbo].[departments]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
