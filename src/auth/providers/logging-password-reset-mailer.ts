import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import type {
  PasswordResetMailer,
  PasswordResetMailInput,
} from './password-reset-mailer.interface';

/**
 * Default PasswordResetMailer (see the interface's doc comment for why this
 * exists instead of a real email provider). Never logs the raw reset token
 * in production — docs/SECURITY.md §8 forbids logging sensitive credential
 * material, and a reset token is bearer-equivalent to a password. In
 * development/test it logs the token at `debug` level purely so the flow is
 * exercisable end-to-end without a mail server; in production it logs only
 * that delivery could not happen, so an operator notices the gap instead of
 * silently believing users are receiving reset emails.
 */
@Injectable()
export class LoggingPasswordResetMailer implements PasswordResetMailer {
  private readonly logger = new Logger(LoggingPasswordResetMailer.name);

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  send(input: PasswordResetMailInput): Promise<void> {
    const isProduction = this.configService.get('nodeEnv', { infer: true }) === 'production';
    if (isProduction) {
      this.logger.error(
        'No email provider configured — password reset email was not sent. Wire a real PasswordResetMailer (see providers/password-reset-mailer.interface.ts) before relying on this flow in production.',
      );
      return Promise.resolve();
    }

    this.logger.debug(
      `[dev-only] Password reset link for ${input.email}: token=${input.token} expiresAt=${input.expiresAt.toISOString()}`,
    );
    return Promise.resolve();
  }
}
