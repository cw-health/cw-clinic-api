export interface NotificationPushInput {
  userId: string;
  title: string;
  body: string;
  /** Loose deep-link hint for the client, e.g. { type: 'Appointment', id }. */
  data?: Record<string, string>;
}

export interface NotificationPushResult {
  /** False (not an error) when the provider had nothing to deliver to — e.g. no registered device token. */
  delivered: boolean;
}

/**
 * Abstraction over "how a push notification is actually delivered" (task
 * brief: "do not tightly couple business logic to FCM"), mirroring
 * PaymentProvider (billing/payment-providers). NotificationDeliveryProcessor
 * depends only on this interface via the NOTIFICATION_PROVIDER token
 * (notifications.module.ts) — SMS/WhatsApp/Email are future second
 * implementations swapped at that binding.
 */
export interface NotificationProvider {
  send(input: NotificationPushInput): Promise<NotificationPushResult>;
}

export const NOTIFICATION_PROVIDER = Symbol('NOTIFICATION_PROVIDER');
