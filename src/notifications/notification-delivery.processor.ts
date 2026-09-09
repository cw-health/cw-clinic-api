import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import type { AppConfig } from '../config/configuration';
import { NOTIFICATION_DELIVERY_QUEUE_NAME } from '../jobs/jobs.module';
import { PrismaService } from '../prisma/prisma.service';
import {
  NOTIFICATION_PROVIDER,
  type NotificationProvider,
} from './providers/notification-provider.interface';

export interface NotificationDeliveryJobData {
  notificationId: string;
}

/**
 * Worker side of the notification-delivery queue (docs/DECISIONS.md
 * ADR-008). Runs in-process (no separate worker deploy target for this
 * app) — started on module init, closed on module destroy. Only a thrown
 * error here (a genuine delivery failure, e.g. FCM unreachable) triggers
 * BullMQ's retry/backoff; a provider result of `{ delivered: false }`
 * (nothing to deliver to) is recorded as SKIPPED, not retried.
 */
@Injectable()
export class NotificationDeliveryProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationDeliveryProcessor.name);
  private worker: Worker<NotificationDeliveryJobData> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<AppConfig, true>,
    @Inject(NOTIFICATION_PROVIDER) private readonly provider: NotificationProvider,
  ) {}

  onModuleInit(): void {
    const redis = this.configService.get('redis', { infer: true });
    this.worker = new Worker<NotificationDeliveryJobData>(
      NOTIFICATION_DELIVERY_QUEUE_NAME,
      (job) => this.process(job),
      { connection: { host: redis.host, port: redis.port, password: redis.password } },
    );
    this.worker.on('failed', (job, err) => {
      if (!job) return;
      const attempts = job.opts.attempts ?? 1;
      // Only persist a terminal FAILED once retries are exhausted — earlier
      // failures are transient and BullMQ will retry them automatically.
      if (job.attemptsMade >= attempts) {
        void this.markFailed(job.data.notificationId, err.message);
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: Job<NotificationDeliveryJobData>): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: job.data.notificationId },
    });
    if (!notification) return; // deleted, or the row write raced the enqueue — nothing to deliver

    const result = await this.provider.send({
      userId: notification.userId,
      title: notification.title,
      body: notification.body,
      data: notification.relatedEntityType
        ? {
            entityType: notification.relatedEntityType,
            entityId: notification.relatedEntityId ?? '',
          }
        : undefined,
    });

    await this.prisma.notification.update({
      where: { id: notification.id },
      data: {
        pushStatus: result.delivered ? 'SENT' : 'SKIPPED',
        pushAttempts: { increment: 1 },
        pushSentAt: result.delivered ? new Date() : undefined,
        pushLastError: null,
      },
    });
  }

  private async markFailed(notificationId: string, error: string): Promise<void> {
    await this.prisma.notification
      .update({
        where: { id: notificationId },
        data: {
          pushStatus: 'FAILED',
          pushAttempts: { increment: 1 },
          pushLastError: error.slice(0, 500),
        },
      })
      .catch((e: unknown) => this.logger.error(`Failed to record push failure: ${String(e)}`));
  }
}
