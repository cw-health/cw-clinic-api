import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { ClinicsService } from '../clinics/clinics.service';
import type { DoctorsService } from '../doctors/doctors.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PatientsService } from '../patients/patients.service';
import type { PrismaService } from '../prisma/prisma.service';
import { AppointmentsService } from './appointments.service';

const doctor = {
  id: 'doctor-1',
  clinicId: 'clinic-a',
  status: 'ACTIVE',
  appointmentDurationMinutes: null,
};
const doctorDto = { id: 'doctor-1', clinicId: 'clinic-a', firstName: 'Ada', lastName: 'Lovelace' };
const patientDto = {
  id: 'patient-1',
  clinicId: 'clinic-a',
  firstName: 'Grace',
  lastName: 'Hopper',
};
const clinic = { id: 'clinic-a', timezone: 'UTC', defaultAppointmentDurationMinutes: 30 };

const baseAppointment = {
  id: 'appt-1',
  clinicId: 'clinic-a',
  doctorId: 'doctor-1',
  patientId: 'patient-1',
  startsAt: new Date('2026-09-10T09:00:00Z'),
  endsAt: new Date('2026-09-10T09:30:00Z'),
  status: 'SCHEDULED',
  type: 'SCHEDULED',
  reasonForVisit: null,
  notes: null,
  createdByUserId: 'user-staff',
  confirmedAt: null,
  checkedInAt: null,
  consultationStartedAt: null,
  completedAt: null,
  noShowAt: null,
  cancelledAt: null,
  cancelledByUserId: null,
  cancellationReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeService() {
  const prisma = {
    appointment: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(baseAppointment),
      update: jest.fn().mockResolvedValue(baseAppointment),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as Record<string, unknown>;
  prisma.$transaction = jest.fn(async (arg: unknown, _opts?: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: unknown) => unknown)(prisma);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });

  const clinicsService = {
    getOwnClinic: jest.fn().mockResolvedValue(clinic),
    getWorkingHoursForDay: jest
      .fn()
      .mockResolvedValue({ isOpen: true, openTime: '09:00', closeTime: '17:00' }),
    isHoliday: jest.fn().mockResolvedValue(false),
  } as unknown as ClinicsService;

  const doctorsService = {
    getDoctorRow: jest.fn().mockResolvedValue(doctor),
    findById: jest.fn().mockResolvedValue(doctorDto),
    findOwn: jest.fn().mockRejectedValue(new NotFoundException()),
    getAvailabilityForDay: jest
      .fn()
      .mockResolvedValue({ isActive: true, startTime: '09:00', endTime: '17:00' }),
    getBreaksForDay: jest.fn().mockResolvedValue([]),
    getUnavailabilityOverlapping: jest.fn().mockResolvedValue([]),
  } as unknown as DoctorsService;

  const patientsService = {
    findById: jest.fn().mockResolvedValue(patientDto),
    findOwn: jest.fn().mockResolvedValue(patientDto),
  } as unknown as PatientsService;

  const notificationsService = {
    create: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationsService;

  // Kept as a plain mock object (not cast to AuditService), same rationale
  // as appointmentsService/doctorsService above — keeps `.record` a plain
  // jest.Mock property so `expect(auditService.record)...` isn't flagged
  // as an unbound method reference.
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new AppointmentsService(
    prisma as unknown as PrismaService,
    clinicsService,
    doctorsService,
    patientsService,
    notificationsService,
    auditService as unknown as AuditService,
  );

  return {
    service,
    prisma,
    clinicsService,
    doctorsService,
    patientsService,
    notificationsService,
    auditService,
  };
}

const future = (isoTime: string) => `2099-01-05T${isoTime}`;

describe('AppointmentsService', () => {
  describe('double-booking prevention', () => {
    it('rejects a create that overlaps an existing appointment for the same doctor, and never records an audit event for the rolled-back booking', async () => {
      const { service, prisma, auditService } = makeService();
      (prisma.appointment as { findFirst: jest.Mock }).findFirst.mockResolvedValueOnce({
        id: 'other',
      });

      await expect(
        service.create('clinic-a', 'user-staff', {
          doctorId: 'doctor-1',
          patientId: 'patient-1',
          startsAt: future('09:00:00.000Z'),
          endsAt: future('09:30:00.000Z'),
        }),
      ).rejects.toThrow(ConflictException);

      // The Prisma create() inside bookAppointment's transaction is never
      // reached — asserting this against the same mock as the real create
      // path is what makes this a rollback test rather than a fake one.
      expect((prisma.appointment as { create: jest.Mock }).create).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('rejects a create that overlaps an existing appointment for the same patient', async () => {
      const { service, prisma } = makeService();
      (prisma.appointment as { findFirst: jest.Mock }).findFirst
        .mockResolvedValueOnce(null) // doctor check passes
        .mockResolvedValueOnce({ id: 'other' }); // patient check conflicts

      await expect(
        service.create('clinic-a', 'user-staff', {
          doctorId: 'doctor-1',
          patientId: 'patient-1',
          startsAt: future('09:00:00.000Z'),
          endsAt: future('09:30:00.000Z'),
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('books successfully when no overlap exists, and records APPOINTMENT_CREATED', async () => {
      const { service, prisma, auditService } = makeService();

      const result = await service.create('clinic-a', 'user-staff', {
        doctorId: 'doctor-1',
        patientId: 'patient-1',
        startsAt: future('09:00:00.000Z'),
        endsAt: future('09:30:00.000Z'),
      });

      expect(result.id).toBe('appt-1');
      expect(prisma.appointment).toBeDefined();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: 'clinic-a',
          actorUserId: 'user-staff',
          entity: 'Appointment',
          entityId: 'appt-1',
          action: 'appointment.created',
        }),
      );
    });

    it('rejects startsAt in the past', async () => {
      const { service } = makeService();
      await expect(
        service.create('clinic-a', 'user-staff', {
          doctorId: 'doctor-1',
          patientId: 'patient-1',
          startsAt: '2020-01-01T09:00:00.000Z',
          endsAt: '2020-01-01T09:30:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects booking a new appointment for a deactivated (non-ACTIVE) doctor', async () => {
      const { service, doctorsService } = makeService();
      (doctorsService.getDoctorRow as jest.Mock).mockResolvedValue({
        ...doctor,
        status: 'INACTIVE',
      });

      await expect(
        service.create('clinic-a', 'user-staff', {
          doctorId: 'doctor-1',
          patientId: 'patient-1',
          startsAt: future('09:00:00.000Z'),
          endsAt: future('09:30:00.000Z'),
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('status transition state machine', () => {
    it('allows SCHEDULED -> CONFIRMED via confirm()', async () => {
      const { service, prisma } = makeService();
      (prisma.appointment as { findFirst: jest.Mock }).findFirst.mockResolvedValue(baseAppointment);

      await service.confirm('clinic-a', 'appt-1', 'user-staff');

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect((prisma.appointment as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'appt-1', clinicId: 'clinic-a' },
          data: expect.objectContaining({ status: 'CONFIRMED' }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('rejects confirm() when the appointment is already COMPLETED', async () => {
      const { service, prisma } = makeService();
      (prisma.appointment as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...baseAppointment,
        status: 'COMPLETED',
      });

      await expect(service.confirm('clinic-a', 'appt-1', 'user-staff')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects check-in from SCHEDULED (must be CONFIRMED first)', async () => {
      const { service, prisma } = makeService();
      (prisma.appointment as { findFirst: jest.Mock }).findFirst.mockResolvedValue(baseAppointment);

      await expect(service.checkIn('clinic-a', 'appt-1', 'user-staff')).rejects.toThrow(
        ConflictException,
      );
    });

    it('allows the full happy path through to COMPLETED', async () => {
      const { service, prisma } = makeService();
      const findFirst = (prisma.appointment as { findFirst: jest.Mock }).findFirst;
      const updateMany = (prisma.appointment as { updateMany: jest.Mock }).updateMany;

      let current = { ...baseAppointment };
      findFirst.mockImplementation(() => Promise.resolve(current));
      updateMany.mockImplementation((args: { data: { status?: string } }) => {
        current = { ...current, ...args.data, status: args.data.status ?? current.status };
        return Promise.resolve({ count: 1 });
      });

      await service.confirm('clinic-a', 'appt-1', 'user-staff');
      await service.checkIn('clinic-a', 'appt-1', 'user-staff');
      await service.waiting('clinic-a', 'appt-1', 'user-staff');
      await service.start('clinic-a', 'appt-1', 'user-staff');
      await service.complete('clinic-a', 'appt-1', 'user-staff');

      expect(current.status).toBe('COMPLETED');
    });

    it('rejects a status transition once terminal (CANCELLED)', async () => {
      const { service, prisma } = makeService();
      (prisma.appointment as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...baseAppointment,
        status: 'CANCELLED',
      });

      await expect(service.checkIn('clinic-a', 'appt-1', 'user-staff')).rejects.toThrow(
        ConflictException,
      );
      await expect(service.noShow('clinic-a', 'appt-1', 'user-staff')).rejects.toThrow(
        ConflictException,
      );
    });

    it('allows WAITING -> NO_SHOW (queue upgrade: a queued patient who never answers a call)', async () => {
      const { service, prisma } = makeService();
      (prisma.appointment as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...baseAppointment,
        status: 'WAITING',
      });

      await service.noShow('clinic-a', 'appt-1', 'user-staff');
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect((prisma.appointment as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'appt-1', clinicId: 'clinic-a' },
          data: expect.objectContaining({ status: 'NO_SHOW' }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });
  });

  describe('ownership scoping', () => {
    it('findById throws ForbiddenException when the appointment does not belong to the scoped patient', async () => {
      const { service, prisma } = makeService();
      (prisma.appointment as { findFirst: jest.Mock }).findFirst.mockResolvedValue(baseAppointment);

      await expect(
        service.findById('clinic-a', 'appt-1', { patientId: 'someone-else' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('findById throws ForbiddenException when the appointment does not belong to the scoped doctor', async () => {
      const { service, prisma } = makeService();
      (prisma.appointment as { findFirst: jest.Mock }).findFirst.mockResolvedValue(baseAppointment);

      await expect(
        service.findById('clinic-a', 'appt-1', { doctorId: 'someone-else' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('findById succeeds when the scope matches', async () => {
      const { service, prisma } = makeService();
      (prisma.appointment as { findFirst: jest.Mock }).findFirst.mockResolvedValue(baseAppointment);

      const result = await service.findById('clinic-a', 'appt-1', { patientId: 'patient-1' });
      expect(result.id).toBe('appt-1');
    });

    it('a cross-tenant appointment id 404s rather than leaking existence', async () => {
      const { service, prisma } = makeService();
      (prisma.appointment as { findFirst: jest.Mock }).findFirst.mockResolvedValue(null);

      await expect(service.findById('clinic-b', 'appt-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('cancellation', () => {
    it('cancels a SCHEDULED appointment', async () => {
      const { service, prisma, auditService } = makeService();
      (prisma.appointment as { findFirst: jest.Mock }).findFirst.mockResolvedValue(baseAppointment);

      await service.cancel('clinic-a', 'appt-1', { reason: 'patient request' }, 'user-staff');

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect((prisma.appointment as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'appt-1', clinicId: 'clinic-a' },
          data: expect.objectContaining({ status: 'CANCELLED', cancelledByUserId: 'user-staff' }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: 'clinic-a',
          actorUserId: 'user-staff',
          entity: 'Appointment',
          entityId: 'appt-1',
          action: 'appointment.cancelled',
        }),
      );
    });

    it('rejects cancelling an already-COMPLETED appointment', async () => {
      const { service, prisma } = makeService();
      (prisma.appointment as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...baseAppointment,
        status: 'COMPLETED',
      });

      await expect(service.cancel('clinic-a', 'appt-1', {}, 'user-staff')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('reschedule', () => {
    it('rejects rescheduling a COMPLETED appointment', async () => {
      const { service, prisma } = makeService();
      (prisma.appointment as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...baseAppointment,
        status: 'COMPLETED',
      });

      await expect(
        service.reschedule(
          'clinic-a',
          'appt-1',
          {
            startsAt: future('10:00:00.000Z'),
            endsAt: future('10:30:00.000Z'),
          },
          'user-staff',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('re-checks for overlap against the new time range', async () => {
      const { service, prisma } = makeService();
      const findFirst = (prisma.appointment as { findFirst: jest.Mock }).findFirst;
      findFirst.mockImplementation((args: { where?: { id?: unknown } }) => {
        // findActiveOrThrow looks up by a plain string id; the overlap check
        // (assertNoOverlap) filters by doctorId/patientId with `id: { not: excludeId } }`.
        if (typeof args?.where?.id === 'string') return Promise.resolve(baseAppointment);
        return Promise.resolve({ id: 'colliding-appt' });
      });

      await expect(
        service.reschedule(
          'clinic-a',
          'appt-1',
          {
            startsAt: future('10:00:00.000Z'),
            endsAt: future('10:30:00.000Z'),
          },
          'user-staff',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('available-slots calculation', () => {
    it('returns no slots for a deactivated (non-ACTIVE) doctor', async () => {
      const { service, doctorsService } = makeService();
      (doctorsService.getDoctorRow as jest.Mock).mockResolvedValue({
        ...doctor,
        status: 'INACTIVE',
      });

      const slots = await service.getAvailableSlots('clinic-a', {
        doctorId: 'doctor-1',
        date: '2099-01-05',
      });
      expect(slots).toEqual([]);
    });

    it('returns no slots on a clinic holiday', async () => {
      const { service, clinicsService } = makeService();
      (clinicsService.isHoliday as jest.Mock).mockResolvedValue(true);

      const slots = await service.getAvailableSlots('clinic-a', {
        doctorId: 'doctor-1',
        date: '2099-01-05',
      });
      expect(slots).toEqual([]);
    });

    it('returns no slots when the clinic is closed that day', async () => {
      const { service, clinicsService } = makeService();
      (clinicsService.getWorkingHoursForDay as jest.Mock).mockResolvedValue({ isOpen: false });

      const slots = await service.getAvailableSlots('clinic-a', {
        doctorId: 'doctor-1',
        date: '2099-01-05',
      });
      expect(slots).toEqual([]);
    });

    it('returns no slots when the doctor has no availability that day', async () => {
      const { service, doctorsService } = makeService();
      (doctorsService.getAvailabilityForDay as jest.Mock).mockResolvedValue(null);

      const slots = await service.getAvailableSlots('clinic-a', {
        doctorId: 'doctor-1',
        date: '2099-01-05',
      });
      expect(slots).toEqual([]);
    });

    it('chunks the working interval into duration-sized slots', async () => {
      const { service, clinicsService, doctorsService } = makeService();
      (clinicsService.getWorkingHoursForDay as jest.Mock).mockResolvedValue({
        isOpen: true,
        openTime: '09:00',
        closeTime: '10:00',
      });
      (doctorsService.getAvailabilityForDay as jest.Mock).mockResolvedValue({
        isActive: true,
        startTime: '09:00',
        endTime: '10:00',
      });
      (clinicsService.getOwnClinic as jest.Mock).mockResolvedValue({
        ...clinic,
        defaultAppointmentDurationMinutes: 30,
      });

      const slots = await service.getAvailableSlots('clinic-a', {
        doctorId: 'doctor-1',
        date: '2099-01-05',
      });
      expect(slots).toHaveLength(2);
      expect(slots[0].startsAt.toISOString()).toBe('2099-01-05T09:00:00.000Z');
      expect(slots[1].startsAt.toISOString()).toBe('2099-01-05T09:30:00.000Z');
    });

    it('removes a slot that overlaps a break', async () => {
      const { service, clinicsService, doctorsService } = makeService();
      (clinicsService.getWorkingHoursForDay as jest.Mock).mockResolvedValue({
        isOpen: true,
        openTime: '09:00',
        closeTime: '10:00',
      });
      (doctorsService.getAvailabilityForDay as jest.Mock).mockResolvedValue({
        isActive: true,
        startTime: '09:00',
        endTime: '10:00',
      });
      (doctorsService.getBreaksForDay as jest.Mock).mockResolvedValue([
        { startTime: '09:00', endTime: '09:30' },
      ]);

      const slots = await service.getAvailableSlots('clinic-a', {
        doctorId: 'doctor-1',
        date: '2099-01-05',
      });
      expect(slots).toHaveLength(1);
      expect(slots[0].startsAt.toISOString()).toBe('2099-01-05T09:30:00.000Z');
    });

    it('removes a slot already booked by an existing non-cancelled appointment', async () => {
      const { service, clinicsService, doctorsService, prisma } = makeService();
      (clinicsService.getWorkingHoursForDay as jest.Mock).mockResolvedValue({
        isOpen: true,
        openTime: '09:00',
        closeTime: '10:00',
      });
      (doctorsService.getAvailabilityForDay as jest.Mock).mockResolvedValue({
        isActive: true,
        startTime: '09:00',
        endTime: '10:00',
      });
      (prisma.appointment as { findMany: jest.Mock }).findMany.mockResolvedValue([
        {
          startsAt: new Date('2099-01-05T09:00:00.000Z'),
          endsAt: new Date('2099-01-05T09:30:00.000Z'),
        },
      ]);

      const slots = await service.getAvailableSlots('clinic-a', {
        doctorId: 'doctor-1',
        date: '2099-01-05',
      });
      expect(slots).toHaveLength(1);
      expect(slots[0].startsAt.toISOString()).toBe('2099-01-05T09:30:00.000Z');
    });
  });

  describe('appointment type', () => {
    it('defaults a staff-created appointment to type SCHEDULED', async () => {
      const { service } = makeService();

      const result = await service.create('clinic-a', 'user-staff', {
        doctorId: 'doctor-1',
        patientId: 'patient-1',
        startsAt: future('09:00:00.000Z'),
        endsAt: future('09:30:00.000Z'),
      });

      expect(result.type).toBe('SCHEDULED');
    });

    it('honors an explicit FOLLOW_UP type on staff create', async () => {
      const { service, prisma } = makeService();
      (prisma.appointment as { create: jest.Mock }).create.mockResolvedValue({
        ...baseAppointment,
        type: 'FOLLOW_UP',
      });

      const result = await service.create('clinic-a', 'user-staff', {
        doctorId: 'doctor-1',
        patientId: 'patient-1',
        startsAt: future('09:00:00.000Z'),
        endsAt: future('09:30:00.000Z'),
        type: 'FOLLOW_UP',
      });

      expect(result.type).toBe('FOLLOW_UP');
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect((prisma.appointment as { create: jest.Mock }).create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'FOLLOW_UP' }) }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('always books a patient self-booking as type SCHEDULED, ignoring any type on the (typeless) DTO', async () => {
      const { service, prisma } = makeService();

      await service.createOwn('clinic-a', 'user-patient', {
        doctorId: 'doctor-1',
        startsAt: future('09:00:00.000Z'),
        endsAt: future('09:30:00.000Z'),
      });

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect((prisma.appointment as { create: jest.Mock }).create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'SCHEDULED' }) }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });
  });

  describe('createWalkIn', () => {
    function walkInDoctorDefaults(clinicsService: ClinicsService, doctorsService: DoctorsService) {
      (clinicsService.getWorkingHoursForDay as jest.Mock).mockResolvedValue({ isOpen: true });
      (doctorsService.getAvailabilityForDay as jest.Mock).mockResolvedValue({ isActive: true });
    }

    it('creates a walk-in already CHECKED_IN, type WALK_IN, without going through transitionStatus', async () => {
      const { service, prisma, clinicsService, doctorsService, auditService } = makeService();
      walkInDoctorDefaults(clinicsService, doctorsService);
      (prisma.appointment as { create: jest.Mock }).create.mockResolvedValue({
        ...baseAppointment,
        type: 'WALK_IN',
        status: 'CHECKED_IN',
        checkedInAt: new Date(),
      });

      const result = await service.createWalkIn('clinic-a', 'user-frontdesk', {
        doctorId: 'doctor-1',
        patientId: 'patient-1',
      });

      expect(result.status).toBe('CHECKED_IN');
      expect(result.type).toBe('WALK_IN');
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect((prisma.appointment as { create: jest.Mock }).create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'WALK_IN',
            status: 'CHECKED_IN',
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'appointment.walk_in_created',
          actorUserId: 'user-frontdesk',
        }),
      );
    });

    it('does not require startsAt to be in the future (a walk-in is "now")', async () => {
      const { service, clinicsService, doctorsService } = makeService();
      walkInDoctorDefaults(clinicsService, doctorsService);

      await expect(
        service.createWalkIn('clinic-a', 'user-frontdesk', {
          doctorId: 'doctor-1',
          patientId: 'patient-1',
        }),
      ).resolves.toBeDefined();
    });

    it('skips the doctor-side overlap lookup entirely for WALK_IN (only the patient-side query runs)', async () => {
      const { service, prisma, clinicsService, doctorsService } = makeService();
      walkInDoctorDefaults(clinicsService, doctorsService);

      await service.createWalkIn('clinic-a', 'user-frontdesk', {
        doctorId: 'doctor-1',
        patientId: 'patient-1',
      });

      // One overlap lookup (patient-side) instead of the two bookAppointment
      // issues for a normal SCHEDULED/FOLLOW_UP booking — proves a second
      // walk-in for the same doctor at the same moment is never blocked.
      expect((prisma.appointment as { findFirst: jest.Mock }).findFirst).toHaveBeenCalledTimes(1);
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect((prisma.appointment as { findFirst: jest.Mock }).findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ patientId: 'patient-1' }) }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('still rejects when the patient already has an overlapping appointment', async () => {
      const { service, clinicsService, doctorsService, prisma } = makeService();
      walkInDoctorDefaults(clinicsService, doctorsService);
      // The doctor-side check is skipped entirely for WALK_IN (no query
      // issued for it), so this single mock resolution is the patient-side
      // overlap lookup — the only one that runs.
      (prisma.appointment as { findFirst: jest.Mock }).findFirst.mockResolvedValueOnce({
        id: 'other',
      });

      await expect(
        service.createWalkIn('clinic-a', 'user-frontdesk', {
          doctorId: 'doctor-1',
          patientId: 'patient-1',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects on a clinic holiday', async () => {
      const { service, clinicsService, doctorsService } = makeService();
      walkInDoctorDefaults(clinicsService, doctorsService);
      (clinicsService.isHoliday as jest.Mock).mockResolvedValue(true);

      await expect(
        service.createWalkIn('clinic-a', 'user-frontdesk', {
          doctorId: 'doctor-1',
          patientId: 'patient-1',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects when the clinic is closed today', async () => {
      const { service, clinicsService, doctorsService } = makeService();
      walkInDoctorDefaults(clinicsService, doctorsService);
      (clinicsService.getWorkingHoursForDay as jest.Mock).mockResolvedValue({ isOpen: false });

      await expect(
        service.createWalkIn('clinic-a', 'user-frontdesk', {
          doctorId: 'doctor-1',
          patientId: 'patient-1',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects when the doctor has no availability today', async () => {
      const { service, clinicsService, doctorsService } = makeService();
      walkInDoctorDefaults(clinicsService, doctorsService);
      (doctorsService.getAvailabilityForDay as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createWalkIn('clinic-a', 'user-frontdesk', {
          doctorId: 'doctor-1',
          patientId: 'patient-1',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects for a deactivated (non-ACTIVE) doctor', async () => {
      const { service, doctorsService, clinicsService } = makeService();
      walkInDoctorDefaults(clinicsService, doctorsService);
      (doctorsService.getDoctorRow as jest.Mock).mockResolvedValue({
        ...doctor,
        status: 'INACTIVE',
      });

      await expect(
        service.createWalkIn('clinic-a', 'user-frontdesk', {
          doctorId: 'doctor-1',
          patientId: 'patient-1',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('audit coverage of every transition', () => {
    const cases: Array<{
      name: string;
      status: string;
      run: (service: AppointmentsService) => Promise<unknown>;
      action: string;
    }> = [
      {
        name: 'confirm',
        status: 'SCHEDULED',
        run: (service) => service.confirm('clinic-a', 'appt-1', 'user-staff'),
        action: 'appointment.confirmed',
      },
      {
        name: 'waiting',
        status: 'CHECKED_IN',
        run: (service) => service.waiting('clinic-a', 'appt-1', 'user-staff'),
        action: 'appointment.waiting',
      },
      {
        name: 'start',
        status: 'WAITING',
        run: (service) => service.start('clinic-a', 'appt-1', 'user-staff'),
        action: 'appointment.started',
      },
      {
        name: 'complete',
        status: 'IN_CONSULTATION',
        run: (service) => service.complete('clinic-a', 'appt-1', 'user-staff'),
        action: 'appointment.completed',
      },
      {
        name: 'noShow',
        status: 'SCHEDULED',
        run: (service) => service.noShow('clinic-a', 'appt-1', 'user-staff'),
        action: 'appointment.no_show',
      },
    ];

    it.each(cases)('$name records $action', async ({ status, run, action }) => {
      const { service, prisma, auditService } = makeService();
      (prisma.appointment as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...baseAppointment,
        status,
      });

      await run(service);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: 'clinic-a',
          actorUserId: 'user-staff',
          entity: 'Appointment',
          entityId: 'appt-1',
          action,
        }),
      );
    });
  });

  describe('getAppointmentsByIds (cross-module bulk read for the queue module)', () => {
    it('returns [] without querying when given no ids', async () => {
      const { service, prisma } = makeService();
      const result = await service.getAppointmentsByIds('clinic-a', []);
      expect(result).toEqual([]);
      expect((prisma.appointment as { findMany: jest.Mock }).findMany).not.toHaveBeenCalled();
    });

    it('scopes the lookup to clinicId and the given ids', async () => {
      const { service, prisma } = makeService();
      (prisma.appointment as { findMany: jest.Mock }).findMany.mockResolvedValue([baseAppointment]);

      const result = await service.getAppointmentsByIds('clinic-a', ['appt-1', 'appt-2']);
      expect(result).toHaveLength(1);

      expect((prisma.appointment as { findMany: jest.Mock }).findMany).toHaveBeenCalledWith({
        where: { clinicId: 'clinic-a', id: { in: ['appt-1', 'appt-2'] } },
      });
    });
  });

  describe('automatic no-show handling', () => {
    it('findOverdueForNoShow only matches SCHEDULED/CONFIRMED appointments starting before the cutoff', async () => {
      const { service, prisma } = makeService();
      (prisma.appointment as { findMany: jest.Mock }).findMany.mockResolvedValue([
        { id: 'appt-1', clinicId: 'clinic-a', startsAt: new Date('2026-01-01T09:00:00Z') },
      ]);

      const cutoff = new Date('2026-01-01T09:30:00Z');
      const overdue = await service.findOverdueForNoShow(cutoff);

      expect(overdue).toHaveLength(1);
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect((prisma.appointment as { findMany: jest.Mock }).findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['SCHEDULED', 'CONFIRMED'] },
            startsAt: { lt: cutoff },
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('autoMarkNoShow transitions via the same chokepoint as manual noShow(), audited under a system actor', async () => {
      const { service, prisma, auditService } = makeService();
      (prisma.appointment as { findFirst: jest.Mock }).findFirst.mockResolvedValue(baseAppointment);

      const result = await service.autoMarkNoShow('clinic-a', 'appt-1');

      expect(result.id).toBe('appt-1');
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect((prisma.appointment as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'appt-1', clinicId: 'clinic-a' },
          data: expect.objectContaining({ status: 'NO_SHOW' }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design */
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: 'clinic-a',
          entity: 'Appointment',
          entityId: 'appt-1',
          action: 'appointment.no_show',
          actorUserId: expect.stringContaining('system'),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('autoMarkNoShow still respects ALLOWED_TRANSITIONS — refuses a terminal appointment', async () => {
      const { service, prisma } = makeService();
      (prisma.appointment as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...baseAppointment,
        status: 'CANCELLED',
      });

      await expect(service.autoMarkNoShow('clinic-a', 'appt-1')).rejects.toThrow(ConflictException);
    });
  });
});
