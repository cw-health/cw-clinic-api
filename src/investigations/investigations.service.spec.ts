import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { ConsultationsService } from '../consultations/consultations.service';
import type { PrismaService } from '../prisma/prisma.service';
import { InvestigationsService } from './investigations.service';

const inProgressConsultation = {
  id: 'consult-1',
  clinicId: 'clinic-a',
  doctorId: 'doctor-1',
  status: 'IN_PROGRESS',
};

const completedConsultation = { ...inProgressConsultation, status: 'COMPLETED' };

const orderRow = {
  id: 'order-1',
  clinicId: 'clinic-a',
  consultationId: 'consult-1',
  doctorId: 'doctor-1',
  testName: 'Complete Blood Count',
  category: 'Lab',
  priority: 'ROUTINE',
  clinicalNotes: null,
  status: 'ORDERED',
  createdByUserId: 'user-doctor',
  cancelledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeService() {
  const prisma = {
    investigationOrder: {
      create: jest.fn().mockResolvedValue(orderRow),
      findMany: jest.fn().mockResolvedValue([orderRow]),
      findFirst: jest.fn().mockResolvedValue(orderRow),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };

  const consultationsService = {
    findById: jest.fn().mockResolvedValue(inProgressConsultation),
  };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new InvestigationsService(
    prisma as unknown as PrismaService,
    consultationsService as unknown as ConsultationsService,
    auditService as unknown as AuditService,
  );

  return { service, prisma, consultationsService, auditService };
}

describe('InvestigationsService', () => {
  describe('create', () => {
    it('orders an investigation for an in-progress consultation', async () => {
      const { service, auditService } = makeService();

      const result = await service.create('clinic-a', 'consult-1', 'user-doctor', {
        testName: 'Complete Blood Count',
      });

      expect(result.id).toBe('order-1');
      expect(result.status).toBe('ORDERED');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'InvestigationOrder',
          action: 'investigation_order.created',
        }),
      );
    });

    it('rejects ordering an investigation on a completed consultation', async () => {
      const { service, consultationsService } = makeService();
      consultationsService.findById.mockResolvedValue(completedConsultation);

      await expect(
        service.create('clinic-a', 'consult-1', 'user-doctor', {
          testName: 'Complete Blood Count',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("rejects a doctor ordering on another doctor's consultation", async () => {
      const { service } = makeService();

      await expect(
        service.create(
          'clinic-a',
          'consult-1',
          'user-doctor',
          { testName: 'Complete Blood Count' },
          { doctorId: 'someone-else' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('cancel', () => {
    it('cancels an ordered investigation and records an audit entry', async () => {
      const { service, auditService } = makeService();

      const result = await service.cancel('clinic-a', 'order-1', 'user-doctor');

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'InvestigationOrder',
          action: 'investigation_order.cancelled',
        }),
      );
      expect(result.id).toBe('order-1');
    });

    it('rejects cancelling an already-cancelled investigation', async () => {
      const { service, prisma } = makeService();
      (prisma.investigationOrder as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...orderRow,
        status: 'CANCELLED',
      });

      await expect(service.cancel('clinic-a', 'order-1', 'user-doctor')).rejects.toThrow(
        ConflictException,
      );
    });

    it('404s on a cross-tenant order id rather than leaking existence', async () => {
      const { service, prisma } = makeService();
      (prisma.investigationOrder as { findFirst: jest.Mock }).findFirst.mockResolvedValue(null);

      await expect(service.cancel('clinic-b', 'order-1', 'user-doctor')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
