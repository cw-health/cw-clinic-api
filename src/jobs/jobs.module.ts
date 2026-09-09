import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { AppConfig } from '../config/configuration';

/**
 * Generic BullMQ/Redis infrastructure (docs/DECISIONS.md ADR-008). Owns the
 * Queue instance only — the Worker that actually processes jobs lives in
 * the module that understands the job's business logic (e.g.
 * NotificationDeliveryProcessor in notifications.module.ts), so this module
 * never depends back on any feature module.
 */
export const NOTIFICATION_DELIVERY_QUEUE_NAME = 'notification-delivery';
export const NOTIFICATION_DELIVERY_QUEUE = Symbol('NOTIFICATION_DELIVERY_QUEUE');

@Module({
  providers: [
    {
      provide: NOTIFICATION_DELIVERY_QUEUE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const redis = configService.get('redis', { infer: true });
        return new Queue(NOTIFICATION_DELIVERY_QUEUE_NAME, {
          connection: { host: redis.host, port: redis.port, password: redis.password },
          defaultJobOptions: {
            // Retry strategy (task brief): 5 attempts, exponential backoff.
            attempts: 5,
            backoff: { type: 'exponential', delay: 2000 },
            // Keep the queue from growing unbounded — completed/failed jobs
            // are only useful for a short debugging window, the durable
            // record of outcome is Notification.pushStatus in SQL Server.
            removeOnComplete: { age: 24 * 60 * 60 },
            removeOnFail: { age: 7 * 24 * 60 * 60 },
          },
        });
      },
    },
  ],
  exports: [NOTIFICATION_DELIVERY_QUEUE],
})
export class JobsModule implements OnModuleDestroy {
  constructor(@Inject(NOTIFICATION_DELIVERY_QUEUE) private readonly queue: Queue) {}

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
