import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuditModule } from '../audit/audit.module';
import { AuthContextService } from './auth-context.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PasswordResetThrottlerGuard } from './guards/password-reset-throttler.guard';
import { PasswordResetService } from './password-reset.service';
import { LoggingPasswordResetMailer } from './providers/logging-password-reset-mailer';
import { PASSWORD_RESET_MAILER } from './providers/password-reset-mailer.interface';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UserInvitationsService } from './user-invitations.service';

@Module({
  imports: [PassportModule, JwtModule.register({}), AuditModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthContextService,
    JwtStrategy,
    JwtAuthGuard,
    UserInvitationsService,
    PasswordResetService,
    PasswordResetThrottlerGuard,
    { provide: PASSWORD_RESET_MAILER, useClass: LoggingPasswordResetMailer },
  ],
  exports: [AuthContextService, JwtAuthGuard, UserInvitationsService],
})
export class AuthModule {}
