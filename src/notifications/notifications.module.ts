import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { NotificationDeliveryProcessor } from './notification-delivery.processor';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { FcmNotificationProvider } from './providers/fcm-notification.provider';
import { NOTIFICATION_PROVIDER } from './providers/notification-provider.interface';

@Module({
  imports: [JobsModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationDeliveryProcessor,
    { provide: NOTIFICATION_PROVIDER, useClass: FcmNotificationProvider },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
