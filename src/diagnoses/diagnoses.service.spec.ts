import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { ConsultationsService } from '../consultations/consultations.service';
import type { PrismaService } from '../prisma/prisma.service';
import { DiagnosesService } from './diagnoses.service';

const inProgressConsultation = {
  id: 'consult-1',
  clinicId: 'clinic-a',
  doctorId: 'doctor-1',
  status: 'IN_PROGRESS',
};

const completedConsultation = { ...inProgressConsultation, status: 'COMPLETED' };

const diagnosisRow = {
  id: 'diag-1',
  clinicId: 'clinic-a',
  consultationId: 'consult-1',
  doctorId: 'doctor-1',
  type: 'PRIMARY',
  description: 'Influenza',
  icdCode: null,
  sortOrder: 0,
  createdByUserId: 'user-doctor',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeService() {
  const prisma = {
    diagnosis: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(diagnosisRow),
      findMany: jest.fn().mockResolvedValue([diagnosisRow]),
      findFirst: jest.fn().mockResolvedValue(diagnosisRow),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };

  const consultationsService = {
    findById: jest.fn().mockResolvedValue(inProgressConsultation),
  };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new DiagnosesService(
    prisma as unknown as PrismaService,
    consultationsService as unknown as ConsultationsService,
    auditService as unknown as AuditService,
  );

  return { service, prisma, consultationsService, auditService };
}

describe('DiagnosesService', () => {
  describe('create', () => {
    it('creates a diagnosis for an in-progress consultation', async () => {
      const { service, auditService } = makeService();

      const result = await service.create('clinic-a', 'consult-1', 'user-doctor', {
        type: 'PRIMARY',
        description: 'Influenza',
      });

      expect(result.id).toBe('diag-1');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'Diagnosis', action: 'diagnosis.created' }),
      );
    });

    it('rejects adding a diagnosis to a completed consultation', async () => {
      const { service, consultationsService } = makeService();
      consultationsService.findById.mockResolvedValue(completedConsultation);

      await expect(
        service.create('clinic-a', 'consult-1', 'user-doctor', {
          type: 'PRIMARY',
          description: 'Influenza',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("rejects a doctor adding a diagnosis to another doctor's consultation", async () => {
      const { service } = makeService();

      await expect(
        service.create(
          'clinic-a',
          'consult-1',
          'user-doctor',
          { type: 'PRIMARY', description: 'Influenza' },
          { doctorId: 'someone-else' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('remove', () => {
    it('rejects removing a diagnosis from a completed consultation', async () => {
      const { service, consultationsService } = makeService();
      consultationsService.findById.mockResolvedValue(completedConsultation);

      await expect(
        service.remove('clinic-a', 'consult-1', 'diag-1', 'user-doctor'),
      ).rejects.toThrow(ConflictException);
    });

    it('404s when the diagnosis does not belong to this consultation/clinic', async () => {
      const { service, prisma } = makeService();
      (prisma.diagnosis as { findFirst: jest.Mock }).findFirst.mockResolvedValue(null);

      await expect(
        service.remove('clinic-a', 'consult-1', 'diag-1', 'user-doctor'),
      ).rejects.toThrow(NotFoundException);
    });

    it('removes the diagnosis and records an audit entry', async () => {
      const { service, auditService } = makeService();

      await service.remove('clinic-a', 'consult-1', 'diag-1', 'user-doctor');

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'Diagnosis', action: 'diagnosis.deleted' }),
      );
    });
  });
});
