import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Notification, Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { NOTIFICATION_DELIVERY_QUEUE } from '../jobs/jobs.module';
import { PrismaService } from '../prisma/prisma.service';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import { assertScopedWrite } from '../common/scoped-write.util';
import type {
  NotificationPushStatus,
  NotificationResponseDto,
  NotificationType,
} from './dto/notification-response.dto';
import type { QueryNotificationsDto } from './dto/query-notifications.dto';
import type { NotificationDeliveryJobData } from './notification-delivery.processor';
import type { RegisterDeviceTokenDto } from './dto/register-device-token.dto';

/**
 * In-app notifications for one recipient user (doctor or patient) —
 * docs/ROADMAP.md Phase 7. This table is a comms/support record, not a
 * clinical/financial one (docs/DATABASE.md §9 scopes AuditLog writes to
 * clinical/financial tables), so create() deliberately writes no AuditLog
 * entry and the model carries no soft-delete column.
 *
 * `create()` is the only way another module produces a notification — no
 * generic `POST /notifications` HTTP endpoint exists (nothing needs it
 * yet). Every call site outside this module treats it as best-effort:
 * callers wrap the call in `.catch(() => undefined)` so a notification
 * failure never fails the primary write path it accompanies (see
 * appointments.service.ts's create/createOwn/cancel and
 * prescriptions.service.ts's finalize).
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATION_DELIVERY_QUEUE)
    private readonly deliveryQueue: Queue<NotificationDeliveryJobData>,
  ) {}

  async create(
    clinicId: string,
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    relatedEntityType?: string,
    relatedEntityId?: string,
  ): Promise<Notification> {
    const notification = await this.prisma.notification.create({
      data: { clinicId, userId, type, title, body, relatedEntityType, relatedEntityId },
    });

    // Push delivery is async (docs/DECISIONS.md ADR-008) — the in-app row
    // above is the source of truth read by GET /notifications/me and is
    // never blocked on this. jobId = notification.id gives BullMQ's
    // built-in dedup: re-enqueuing the same notification is a no-op, which
    // is the idempotency guard the task brief asks for.
    await this.deliveryQueue
      .add('deliver', { notificationId: notification.id }, { jobId: notification.id })
      .catch(() => undefined);

    return notification;
  }

  async registerDeviceToken(userId: string, dto: RegisterDeviceTokenDto): Promise<void> {
    await this.prisma.userDeviceToken.upsert({
      where: { token: dto.token },
      create: { userId, token: dto.token, platform: dto.platform },
      update: { userId, platform: dto.platform },
    });
  }

  /** NotFoundException (never Forbidden) for a token registered to someone else — don't leak existence. */
  async unregisterDeviceToken(userId: string, token: string): Promise<void> {
    const row = await this.prisma.userDeviceToken.findUnique({ where: { token } });
    if (!row || row.userId !== userId) throw new NotFoundException('Device token not found');
    await this.prisma.userDeviceToken.delete({ where: { token } });
  }

  async findOwn(
    clinicId: string,
    userId: string,
    query: QueryNotificationsDto,
  ): Promise<PaginatedResult<NotificationResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.NotificationWhereInput = {
      clinicId,
      userId,
      ...(query.unreadOnly ? { readAt: null } : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { data: rows.map(toResponseDto), meta: { total, page, pageSize } };
  }

  /**
   * Idempotency guard for the Phase 8 reminder cron
   * (src/reminders/reminders.service.ts): before creating an
   * APPOINTMENT_REMINDER/FOLLOW_UP_REMINDER, the caller checks no
   * notification already exists for this (clinicId, type, relatedEntityId)
   * — belt-and-braces alongside the BullMQ jobId dedup on the delivery side.
   */
  async existsForEntity(
    clinicId: string,
    type: NotificationType,
    relatedEntityId: string,
  ): Promise<boolean> {
    const count = await this.prisma.notification.count({
      where: { clinicId, type, relatedEntityId },
    });
    return count > 0;
  }

  async unreadCount(clinicId: string, userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: { clinicId, userId, readAt: null },
    });
    return { count };
  }

  /** NotFoundException (never Forbidden) for a notification that belongs to someone else — don't leak existence, mirrors invoices.service.ts's findActiveRowOrThrow. */
  async markRead(clinicId: string, userId: string, id: string): Promise<NotificationResponseDto> {
    const row = await this.prisma.notification.findFirst({ where: { id, clinicId } });
    if (!row || row.userId !== userId) throw new NotFoundException('Notification not found');

    if (row.readAt) return toResponseDto(row);

    // Scoped at the query level (clinicId + userId), not only by the read
    // above — see scoped-write.util.ts.
    const result = await this.prisma.notification.updateMany({
      where: { id, clinicId, userId },
      data: { readAt: new Date() },
    });
    assertScopedWrite(result, 'Notification not found');
    const updated = await this.prisma.notification.findFirstOrThrow({ where: { id } });
    return toResponseDto(updated);
  }

  async markAllRead(clinicId: string, userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { clinicId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}

function toResponseDto(row: Notification): NotificationResponseDto {
  return {
    id: row.id,
    clinicId: row.clinicId,
    userId: row.userId,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    relatedEntityType: row.relatedEntityType,
    relatedEntityId: row.relatedEntityId,
    readAt: row.readAt,
    pushStatus: row.pushStatus as NotificationPushStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
