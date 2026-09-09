import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { App } from 'firebase-admin/app';
import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  NotificationProvider,
  NotificationPushInput,
  NotificationPushResult,
} from './notification-provider.interface';

/**
 * FCM-backed NotificationProvider (docs/DECISIONS.md ADR-008). Looks up the
 * user's registered UserDeviceToken rows and pushes to each. With no
 * FCM_SERVICE_ACCOUNT_JSON configured (dev/test default) this logs once and
 * returns `{ delivered: false }` for every call rather than throwing — a
 * missing FCM config is an environment gap, not a per-notification failure
 * that should trip BullMQ's retry/backoff.
 */
@Injectable()
export class FcmNotificationProvider implements NotificationProvider {
  private readonly logger = new Logger(FcmNotificationProvider.name);
  private app: App | null | undefined; // undefined = not yet initialized, null = init failed/unconfigured

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async send(input: NotificationPushInput): Promise<NotificationPushResult> {
    const app = this.getApp();
    if (!app) return { delivered: false };

    const tokens = await this.prisma.userDeviceToken.findMany({
      where: { userId: input.userId },
      select: { token: true },
    });
    if (tokens.length === 0) return { delivered: false };

    const response = await getMessaging(app).sendEachForMulticast({
      tokens: tokens.map((t) => t.token),
      notification: { title: input.title, body: input.body },
      data: input.data,
    });

    // Prune tokens FCM reports as unregistered/invalid so future sends don't keep retrying them.
    const staleTokens = response.responses
      .map((r, i) => (r.success ? null : tokens[i].token))
      .filter((t): t is string => t !== null);
    if (staleTokens.length > 0) {
      await this.prisma.userDeviceToken
        .deleteMany({ where: { token: { in: staleTokens } } })
        .catch(() => undefined);
    }

    return { delivered: response.successCount > 0 };
  }

  private getApp(): App | null {
    if (this.app !== undefined) return this.app;

    const json = this.configService.get('fcmServiceAccountJson', { infer: true });
    if (!json) {
      this.logger.warn('FCM_SERVICE_ACCOUNT_JSON not configured — push notifications are skipped');
      this.app = null;
      return this.app;
    }

    try {
      const serviceAccount = JSON.parse(json) as Record<string, string>;
      this.app = initializeApp({ credential: cert(serviceAccount) }, 'cw-clinic-fcm');
    } catch (error) {
      this.logger.error(
        `Failed to initialize FCM: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.app = null;
    }
    return this.app;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.app) await deleteApp(this.app).catch(() => undefined);
  }
}
