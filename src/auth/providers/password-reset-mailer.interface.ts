export interface PasswordResetMailInput {
  email: string;
  /** Raw, unhashed token — only ever held in memory for this one delivery attempt, never persisted as-is (see PasswordResetService). */
  token: string;
  expiresAt: Date;
}

/**
 * Abstraction over "how a password-reset link is actually delivered",
 * mirroring NotificationProvider (notifications/providers). Bound via the
 * PASSWORD_RESET_MAILER token in auth.module.ts — a real SMTP/transactional-
 * email implementation is future second implementation swapped at that
 * binding, same "documented dependency, not built here" gap the codebase
 * already carries for the Phase 1D staff-invite flow (no email/SMS provider
 * is wired in yet; see UserInvitationsService's doc comment).
 */
export interface PasswordResetMailer {
  send(input: PasswordResetMailInput): Promise<void>;
}

export const PASSWORD_RESET_MAILER = Symbol('PASSWORD_RESET_MAILER');
