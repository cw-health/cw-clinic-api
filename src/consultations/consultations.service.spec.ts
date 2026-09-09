import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AppointmentsService } from '../appointments/appointments.service';
import type { AuditService } from '../audit/audit.service';
import type { DoctorsService } from '../doctors/doctors.service';
import type { PatientsService } from '../patients/patients.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ConsultationsService } from './consultations.service';

const doctorDto = { id: 'doctor-1', clinicId: 'clinic-a', firstName: 'Ada', lastName: 'Lovelace' };
const patientDto = {
  id: 'patient-1',
  clinicId: 'clinic-a',
  firstName: 'Grace',
  lastName: 'Hopper',
};

const baseAppointment = {
  id: 'appt-1',
  clinicId: 'clinic-a',
  doctorId: 'doctor-1',
  patientId: 'patient-1',
  status: 'WAITING',
};

const baseConsultation = {
  id: 'consult-1',
  clinicId: 'clinic-a',
  appointmentId: 'appt-1',
  doctorId: 'doctor-1',
  patientId: 'patient-1',
  status: 'IN_PROGRESS',
  chiefComplaint: 'Fever',
  symptoms: null,
  history: null,
  heightCm: null,
  weightKg: null,
  temperatureCelsius: null,
  pulseBpm: null,
  bloodPressureSystolic: null,
  bloodPressureDiastolic: null,
  respiratoryRate: null,
  spo2Percent: null,
  examination: null,
  diagnosis: null,
  investigations: null,
  treatment: null,
  advice: null,
  followUpDate: null,
  followUpInstructions: null,
  notes: null,
  templateKey: null,
  customFields: null,
  createdByUserId: 'user-doctor',
  completedAt: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeService() {
  const prisma = {
    consultation: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(baseConsultation),
      update: jest.fn().mockResolvedValue(baseConsultation),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    consultationAmendment: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as Record<string, unknown>;
  prisma.$transaction = jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(prisma);
    return Promise.all(arg as Promise<unknown>[]);
  });

  // Kept as plain mock objects (not cast to the real service types) so
  // `.start`/`.complete` stay plain jest.Mock properties for assertions —
  // casting to the real class type here makes @typescript-eslint/unbound-method
  // flag `expect(appointmentsService.start)...` as an unbound method reference.
  const appointmentsService = {
    getAppointmentRow: jest.fn().mockResolvedValue(baseAppointment),
    start: jest.fn().mockResolvedValue({}),
    complete: jest.fn().mockResolvedValue({}),
  };

  const doctorsService = {
    findById: jest.fn().mockResolvedValue(doctorDto),
  };

  const patientsService = {
    findById: jest.fn().mockResolvedValue(patientDto),
  };

  const auditService = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new ConsultationsService(
    prisma as unknown as PrismaService,
    appointmentsService as unknown as AppointmentsService,
    doctorsService as unknown as DoctorsService,
    patientsService as unknown as PatientsService,
    auditService as unknown as AuditService,
  );

  return { service, prisma, appointmentsService, doctorsService, patientsService, auditService };
}

describe('ConsultationsService', () => {
  describe('create', () => {
    it('creates a consultation for a WAITING appointment and starts it', async () => {
      const { service, appointmentsService } = makeService();

      const result = await service.create('clinic-a', 'user-doctor', {
        appointmentId: 'appt-1',
        chiefComplaint: 'Fever',
      });

      expect(result.id).toBe('consult-1');
      expect(appointmentsService.start).toHaveBeenCalledWith(
        'clinic-a',
        'appt-1',
        'user-doctor',
        undefined,
      );
    });

    it('does not re-trigger start() when the appointment is already IN_CONSULTATION', async () => {
      const { service, appointmentsService } = makeService();
      appointmentsService.getAppointmentRow.mockResolvedValue({
        ...baseAppointment,
        status: 'IN_CONSULTATION',
      });

      await service.create('clinic-a', 'user-doctor', {
        appointmentId: 'appt-1',
        chiefComplaint: 'Fever',
      });

      expect(appointmentsService.start).not.toHaveBeenCalled();
    });

    it('rejects when the appointment is not found', async () => {
      const { service, appointmentsService } = makeService();
      appointmentsService.getAppointmentRow.mockResolvedValue(null);

      await expect(
        service.create('clinic-a', 'user-doctor', {
          appointmentId: 'appt-1',
          chiefComplaint: 'Fever',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("rejects a doctor creating a consultation for another doctor's appointment", async () => {
      const { service } = makeService();

      await expect(
        service.create(
          'clinic-a',
          'user-doctor',
          { appointmentId: 'appt-1', chiefComplaint: 'Fever' },
          { doctorId: 'someone-else' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when the appointment is not yet WAITING/IN_CONSULTATION', async () => {
      const { service, appointmentsService } = makeService();
      appointmentsService.getAppointmentRow.mockResolvedValue({
        ...baseAppointment,
        status: 'CHECKED_IN',
      });

      await expect(
        service.create('clinic-a', 'user-doctor', {
          appointmentId: 'appt-1',
          chiefComplaint: 'Fever',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a duplicate consultation for the same appointment', async () => {
      const { service, prisma } = makeService();
      (prisma.consultation as { findFirst: jest.Mock }).findFirst.mockResolvedValue(
        baseConsultation,
      );

      await expect(
        service.create('clinic-a', 'user-doctor', {
          appointmentId: 'appt-1',
          chiefComplaint: 'Fever',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('maps a P2002 unique-constraint race to ConflictException', async () => {
      const { service, prisma } = makeService();

      (prisma.consultation as { create: jest.Mock }).create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.create('clinic-a', 'user-doctor', {
          appointmentId: 'appt-1',
          chiefComplaint: 'Fever',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('rejects updating a completed consultation', async () => {
      const { service, prisma } = makeService();
      (prisma.consultation as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...baseConsultation,
        status: 'COMPLETED',
      });

      await expect(
        service.update('clinic-a', 'consult-1', { diagnosis: 'Flu' }, 'user-doctor'),
      ).rejects.toThrow(ConflictException);
    });

    it("rejects a doctor updating another doctor's consultation", async () => {
      const { service, prisma } = makeService();
      (prisma.consultation as { findFirst: jest.Mock }).findFirst.mockResolvedValue(
        baseConsultation,
      );

      await expect(
        service.update('clinic-a', 'consult-1', { diagnosis: 'Flu' }, 'user-doctor', {
          doctorId: 'someone-else',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('a cross-tenant consultation id 404s rather than leaking existence', async () => {
      const { service, prisma } = makeService();
      (prisma.consultation as { findFirst: jest.Mock }).findFirst.mockResolvedValue(null);

      await expect(
        service.update('clinic-b', 'consult-1', { diagnosis: 'Flu' }, 'user-doctor'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('complete', () => {
    it('completes the consultation and the linked appointment', async () => {
      const { service, prisma, appointmentsService } = makeService();
      (prisma.consultation as { findFirst: jest.Mock }).findFirst.mockResolvedValue(
        baseConsultation,
      );

      await service.complete('clinic-a', 'consult-1', 'user-doctor');

      expect(appointmentsService.complete).toHaveBeenCalledWith(
        'clinic-a',
        'appt-1',
        'user-doctor',
        undefined,
      );
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect((prisma.consultation as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'consult-1', clinicId: 'clinic-a' },
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('does not re-complete an already-completed appointment', async () => {
      const { service, prisma, appointmentsService } = makeService();
      (prisma.consultation as { findFirst: jest.Mock }).findFirst.mockResolvedValue(
        baseConsultation,
      );
      appointmentsService.getAppointmentRow.mockResolvedValue({
        ...baseAppointment,
        status: 'COMPLETED',
      });

      await service.complete('clinic-a', 'consult-1', 'user-doctor');
      expect(appointmentsService.complete).not.toHaveBeenCalled();
    });

    it('rejects completing an already-completed consultation', async () => {
      const { service, prisma } = makeService();
      (prisma.consultation as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...baseConsultation,
        status: 'COMPLETED',
      });

      await expect(service.complete('clinic-a', 'consult-1', 'user-doctor')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('audit trail (Phase 1F)', () => {
    it('records CONSULTATION_VIEWED via findByIdAudited but not plain findById (PHI access)', async () => {
      const { service, prisma, auditService } = makeService();
      (prisma.consultation as { findFirst: jest.Mock }).findFirst.mockResolvedValue(
        baseConsultation,
      );

      await service.findById('clinic-a', 'consult-1');
      expect(auditService.record).not.toHaveBeenCalled();

      await service.findByIdAudited('clinic-a', 'consult-1', 'user-doctor');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'Consultation',
          entityId: 'consult-1',
          action: 'consultation.viewed',
          actorUserId: 'user-doctor',
        }),
      );
    });

    it('records CONSULTATION_UPDATED with field names only, never diagnosis/symptom values', async () => {
      const { service, prisma, auditService } = makeService();
      (prisma.consultation as { findFirst: jest.Mock }).findFirst.mockResolvedValue(
        baseConsultation,
      );

      await service.update('clinic-a', 'consult-1', { diagnosis: 'Flu' }, 'user-doctor');

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'Consultation',
          action: 'consultation.updated',
          changedFields: 'diagnosis',
        }),
      );
      /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock, loosely typed by design */
      const call = auditService.record.mock.calls[0][0] as { changedFields: string };
      expect(call.changedFields).not.toMatch(/Flu/);
    });

    it('records CONSULTATION_COMPLETED', async () => {
      const { service, prisma, auditService } = makeService();
      (prisma.consultation as { findFirst: jest.Mock }).findFirst.mockResolvedValue(
        baseConsultation,
      );

      await service.complete('clinic-a', 'consult-1', 'user-doctor');

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'Consultation',
          entityId: 'consult-1',
          action: 'consultation.completed',
          actorUserId: 'user-doctor',
        }),
      );
    });
  });

  describe('amend', () => {
    it('rejects amending a consultation that is not yet completed', async () => {
      const { service, prisma } = makeService();
      (prisma.consultation as { findFirst: jest.Mock }).findFirst.mockResolvedValue(
        baseConsultation,
      );

      await expect(
        service.amend(
          'clinic-a',
          'consult-1',
          { reason: 'Correcting a typo', diagnosis: 'Flu' },
          'user-doctor',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it("rejects a doctor amending another doctor's consultation", async () => {
      const { service, prisma } = makeService();
      (prisma.consultation as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...baseConsultation,
        status: 'COMPLETED',
      });

      await expect(
        service.amend(
          'clinic-a',
          'consult-1',
          { reason: 'Correcting a typo', diagnosis: 'Flu' },
          'user-doctor',
          { doctorId: 'someone-else' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an amendment with no fields supplied', async () => {
      const { service, prisma } = makeService();
      (prisma.consultation as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...baseConsultation,
        status: 'COMPLETED',
      });

      await expect(
        service.amend('clinic-a', 'consult-1', { reason: 'Just checking' }, 'user-doctor'),
      ).rejects.toThrow(ConflictException);
    });

    it('writes a ConsultationAmendment row with the previous value and an audit entry with field names only', async () => {
      const { service, prisma, auditService } = makeService();
      (prisma.consultation as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...baseConsultation,
        status: 'COMPLETED',
        diagnosis: 'Common cold',
      });

      await service.amend(
        'clinic-a',
        'consult-1',
        { reason: 'Corrected after lab result came back', diagnosis: 'Influenza' },
        'user-doctor',
      );

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect((prisma.consultationAmendment as { create: jest.Mock }).create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            consultationId: 'consult-1',
            amendedByUserId: 'user-doctor',
            reason: 'Corrected after lab result came back',
            changedFields: 'diagnosis',
            previousValues: JSON.stringify({ diagnosis: 'Common cold' }),
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'Consultation',
          action: 'consultation.amended',
          changedFields: 'diagnosis',
        }),
      );
      /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock, loosely typed by design */
      const call = auditService.record.mock.calls[0][0] as { changedFields: string };
      expect(call.changedFields).not.toMatch(/Influenza|Common cold/);
    });
  });

  describe('history (findAll)', () => {
    it('filters by patientId — the previous-consultations view', async () => {
      const { service, prisma } = makeService();

      await service.findAll('clinic-a', { patientId: 'patient-1' });

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect((prisma.consultation as { findMany: jest.Mock }).findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ clinicId: 'clinic-a', patientId: 'patient-1' }),
          orderBy: { createdAt: 'desc' },
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });
  });
});
