export type NotificationType =
  | 'APPOINTMENT_BOOKED'
  | 'APPOINTMENT_CONFIRMED'
  | 'APPOINTMENT_CANCELLED'
  | 'APPOINTMENT_REMINDER'
  | 'PRESCRIPTION_READY'
  | 'FOLLOW_UP_REMINDER'
  | 'GENERAL';

/** One of: PENDING, SENT, FAILED, SKIPPED — see Notification.pushStatus in schema.prisma. */
export type NotificationPushStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

export interface NotificationResponseDto {
  id: string;
  clinicId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  readAt: Date | null;
  pushStatus: NotificationPushStatus;
  createdAt: Date;
  updatedAt: Date;
}
