import { NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationDeliveryJobData } from './notification-delivery.processor';
import { NotificationsService } from './notifications.service';

const baseNotification = {
  id: 'notif-1',
  clinicId: 'clinic-a',
  userId: 'user-patient-1',
  type: 'APPOINTMENT_BOOKED',
  title: 'Appointment booked',
  body: 'Your appointment has been booked.',
  relatedEntityType: 'Appointment',
  relatedEntityId: 'appt-1',
  readAt: null as Date | null,
  pushStatus: 'PENDING',
  pushAttempts: 0,
  pushSentAt: null as Date | null,
  pushLastError: null as string | null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeService() {
  const prisma = {
    notification: {
      create: jest.fn().mockResolvedValue(baseNotification),
      findFirst: jest.fn().mockResolvedValue(baseNotification),
      findMany: jest.fn().mockResolvedValue([baseNotification]),
      count: jest.fn().mockResolvedValue(1),
      update: jest.fn().mockResolvedValue({ ...baseNotification, readAt: new Date() }),
      updateMany: jest.fn().mockResolvedValue({ count: 3 }),
      findFirstOrThrow: jest.fn().mockResolvedValue({ ...baseNotification, readAt: new Date() }),
    },
    userDeviceToken: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue({}),
    },
  } as unknown as Record<string, unknown>;
  prisma.$transaction = jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(prisma);
    return Promise.all(arg as Promise<unknown>[]);
  });

  const deliveryQueue = {
    add: jest.fn().mockResolvedValue(undefined),
  } as unknown as Queue<NotificationDeliveryJobData>;

  const service = new NotificationsService(prisma as unknown as PrismaService, deliveryQueue);
  return { service, prisma, deliveryQueue };
}

describe('NotificationsService', () => {
  describe('create', () => {
    it('writes a notification row for the given recipient', async () => {
      const { service, prisma } = makeService();
      await service.create(
        'clinic-a',
        'user-patient-1',
        'APPOINTMENT_BOOKED',
        'Appointment booked',
        'Your appointment has been booked.',
        'Appointment',
        'appt-1',
      );
      expect((prisma.notification as { create: jest.Mock }).create).toHaveBeenCalledWith({
        data: {
          clinicId: 'clinic-a',
          userId: 'user-patient-1',
          type: 'APPOINTMENT_BOOKED',
          title: 'Appointment booked',
          body: 'Your appointment has been booked.',
          relatedEntityType: 'Appointment',
          relatedEntityId: 'appt-1',
        },
      });
    });

    it('enqueues a delivery job keyed by the notification id, for BullMQ jobId dedup', async () => {
      const { service, deliveryQueue } = makeService();
      await service.create(
        'clinic-a',
        'user-patient-1',
        'APPOINTMENT_BOOKED',
        'Appointment booked',
        'Your appointment has been booked.',
        'Appointment',
        'appt-1',
      );
      expect((deliveryQueue as unknown as { add: jest.Mock }).add).toHaveBeenCalledWith(
        'deliver',
        { notificationId: baseNotification.id },
        { jobId: baseNotification.id },
      );
    });

    it('does not fail the write path when enqueueing the delivery job fails', async () => {
      const { service, deliveryQueue } = makeService();
      (deliveryQueue.add as jest.Mock).mockRejectedValueOnce(new Error('redis down'));
      await expect(
        service.create(
          'clinic-a',
          'user-patient-1',
          'APPOINTMENT_BOOKED',
          'Appointment booked',
          'Your appointment has been booked.',
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('existsForEntity', () => {
    it('is the idempotency check the reminder cron uses before creating a duplicate', async () => {
      const { service, prisma } = makeService();
      const result = await service.existsForEntity('clinic-a', 'APPOINTMENT_REMINDER', 'appt-1');
      expect(result).toBe(true);
      expect((prisma.notification as { count: jest.Mock }).count).toHaveBeenCalledWith({
        where: { clinicId: 'clinic-a', type: 'APPOINTMENT_REMINDER', relatedEntityId: 'appt-1' },
      });
    });
  });

  describe('registerDeviceToken / unregisterDeviceToken', () => {
    it('upserts by token so re-registering the same device is idempotent', async () => {
      const { service, prisma } = makeService();
      await service.registerDeviceToken('user-patient-1', {
        token: 'fcm-token',
        platform: 'ANDROID',
      });
      expect((prisma.userDeviceToken as { upsert: jest.Mock }).upsert).toHaveBeenCalledWith({
        where: { token: 'fcm-token' },
        create: { userId: 'user-patient-1', token: 'fcm-token', platform: 'ANDROID' },
        update: { userId: 'user-patient-1', platform: 'ANDROID' },
      });
    });

    it('404s (never leaking existence) when unregistering a token owned by someone else', async () => {
      const { service, prisma } = makeService();
      (prisma.userDeviceToken as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
        userId: 'someone-else',
        token: 'fcm-token',
      });
      await expect(service.unregisterDeviceToken('user-patient-1', 'fcm-token')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findOwn', () => {
    it('scopes the query to clinicId + the caller userId, and applies unreadOnly', async () => {
      const { service, prisma } = makeService();
      await service.findOwn('clinic-a', 'user-patient-1', {
        unreadOnly: true,
        page: 1,
        pageSize: 20,
      });
      expect((prisma.notification as { findMany: jest.Mock }).findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clinicId: 'clinic-a', userId: 'user-patient-1', readAt: null },
        }),
      );
    });
  });

  describe('unreadCount', () => {
    it('returns the unread count for the caller', async () => {
      const { service } = makeService();
      const result = await service.unreadCount('clinic-a', 'user-patient-1');
      expect(result).toEqual({ count: 1 });
    });
  });

  describe('markRead — ownership scoping', () => {
    it('marks the caller-owned notification read, scoping the write by clinicId + userId', async () => {
      const { service, prisma } = makeService();
      (prisma.notification as { updateMany: jest.Mock }).updateMany.mockResolvedValueOnce({
        count: 1,
      });
      const result = await service.markRead('clinic-a', 'user-patient-1', 'notif-1');
      expect(result.id).toBe('notif-1');
      expect((prisma.notification as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith({
        where: { id: 'notif-1', clinicId: 'clinic-a', userId: 'user-patient-1' },
        data: { readAt: expect.any(Date) as Date },
      });
    });

    it('404s if the scoped write somehow matches no row (defense in depth)', async () => {
      const { service, prisma } = makeService();
      (prisma.notification as { updateMany: jest.Mock }).updateMany.mockResolvedValueOnce({
        count: 0,
      });
      await expect(service.markRead('clinic-a', 'user-patient-1', 'notif-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404s (never leaking existence) when the notification belongs to another user', async () => {
      const { service, prisma } = makeService();
      (prisma.notification as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...baseNotification,
        userId: 'someone-else',
      });
      await expect(service.markRead('clinic-a', 'user-patient-1', 'notif-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404s when no row exists', async () => {
      const { service, prisma } = makeService();
      (prisma.notification as { findFirst: jest.Mock }).findFirst.mockResolvedValue(null);
      await expect(service.markRead('clinic-a', 'user-patient-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('is a no-op (skips the write) when already read', async () => {
      const { service, prisma } = makeService();
      (prisma.notification as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
        ...baseNotification,
        readAt: new Date(),
      });
      await service.markRead('clinic-a', 'user-patient-1', 'notif-1');
      expect((prisma.notification as { updateMany: jest.Mock }).updateMany).not.toHaveBeenCalled();
    });
  });

  describe('markAllRead', () => {
    it('updates only the caller unread rows and returns the count', async () => {
      const { service, prisma } = makeService();
      const result = await service.markAllRead('clinic-a', 'user-patient-1');
      expect(result).toEqual({ updated: 3 });
      expect((prisma.notification as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith({
        where: { clinicId: 'clinic-a', userId: 'user-patient-1', readAt: null },
        data: { readAt: expect.any(Date) as Date },
      });
    });
  });
});
