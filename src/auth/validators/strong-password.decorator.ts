import { applyDecorators } from '@nestjs/common';
import { Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Password policy (docs/SECURITY.md §1) for the self-service password
 * flows (change/reset password) — not retrofitted onto the Phase 1D
 * accept-invite DTO, which keeps its original, looser `@MinLength(8)` to
 * avoid changing already-shipped behavior unrelated to this phase.
 */
export const STRONG_PASSWORD_MIN_LENGTH = 10;
export const STRONG_PASSWORD_MAX_LENGTH = 200;

/** At least one lowercase, one uppercase, one digit, one non-alphanumeric character. */
const STRONG_PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).*$/;

/** Composed `class-validator` decorators enforcing the password policy above — apply to any DTO field that sets a new password. */
export function IsStrongPassword(): PropertyDecorator {
  return applyDecorators(
    MinLength(STRONG_PASSWORD_MIN_LENGTH, {
      message: `Password must be at least ${STRONG_PASSWORD_MIN_LENGTH} characters long`,
    }),
    MaxLength(STRONG_PASSWORD_MAX_LENGTH),
    Matches(STRONG_PASSWORD_PATTERN, {
      message:
        'Password must include an uppercase letter, a lowercase letter, a number, and a special character',
    }),
  );
}
