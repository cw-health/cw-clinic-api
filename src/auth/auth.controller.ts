import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import type { AppConfig } from '../config/configuration';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import type { AuthUserDto, LoginResponseDto } from './dto/auth-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordResetThrottlerGuard } from './guards/password-reset-throttler.guard';
import type { JwtPayload } from './interfaces/jwt-payload.interface';
import { PasswordResetService } from './password-reset.service';
import { parseDurationMs } from './token-expiry.util';

/** Web gets the refresh token exclusively via httpOnly cookie; mobile has no cookie jar and gets it in the body instead. */
function isMobileClient(req: Request): boolean {
  return req.header('x-client-platform') === 'mobile';
}

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  private readonly cookieName: string;
  private readonly cookieOptions: CookieOptions;
  private readonly refreshMaxAgeMs: number;

  constructor(
    private readonly authService: AuthService,
    private readonly passwordResetService: PasswordResetService,
    configService: ConfigService<AppConfig, true>,
  ) {
    this.cookieName = configService.get('refreshCookieName', { infer: true });
    const isProduction = configService.get('nodeEnv', { infer: true }) === 'production';
    // Cross-origin (Admin web app on a different origin than the API)
    // credentialed cookie requires SameSite=None + Secure in production;
    // relaxed to Lax for http-only local development.
    this.cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/api/v1/auth',
    };
    this.refreshMaxAgeMs = parseDurationMs(
      configService.get('jwt', { infer: true }).refreshExpiresIn,
    );
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const session = await this.authService.login(dto, req.ip);
    return this.respondWithSession(
      req,
      res,
      session.accessToken,
      session.refreshToken,
      session.user,
    );
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const cookieToken = (req.cookies as Record<string, string | undefined> | undefined)?.[
      this.cookieName
    ];
    const rawToken = cookieToken ?? dto.refreshToken;
    const session = await this.authService.refresh(rawToken, req.ip);
    return this.respondWithSession(
      req,
      res,
      session.accessToken,
      session.refreshToken,
      session.user,
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(user.sub);
    res.clearCookie(this.cookieName, { path: this.cookieOptions.path });
  }

  @Get('me')
  async me(@CurrentUser() user: JwtPayload): Promise<AuthUserDto> {
    return this.authService.getMe(user.sub, user.clinicId);
  }

  /** Phase 1D: sets a staff member's own password from an invite token (see UserInvitationsService) and logs them in. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  async acceptInvite(
    @Body() dto: AcceptInviteDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const session = await this.authService.acceptInvite(dto.token, dto.password, req.ip);
    return this.respondWithSession(
      req,
      res,
      session.accessToken,
      session.refreshToken,
      session.user,
    );
  }

  /** Authenticated self-service password change — invalidates every outstanding refresh token (docs/SECURITY.md §1), so the client should treat this like a logout and re-prompt for login. */
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.passwordResetService.changePassword(
      user.sub,
      dto.currentPassword,
      dto.newPassword,
      req.ip,
    );
  }

  /**
   * Always responds 204 regardless of whether the email matches an account
   * — prevents account enumeration (docs/SECURITY.md §1/§4). Throttled both
   * by the global per-IP limit below and by PasswordResetThrottlerGuard's
   * IP+email bucket (docs/SECURITY.md §6).
   */
  @Public()
  @UseGuards(PasswordResetThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request): Promise<void> {
    await this.passwordResetService.requestReset(dto.email, req.ip);
  }

  /** Completes a reset from the token issued by forgot-password. Single-use, expires after 1 hour (PasswordResetService). */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request): Promise<void> {
    await this.passwordResetService.reset(dto.token, dto.newPassword, req.ip);
  }

  private respondWithSession(
    req: Request,
    res: Response,
    accessToken: string,
    refreshToken: string,
    user: AuthUserDto,
  ): LoginResponseDto {
    if (isMobileClient(req)) {
      // No cookie jar to rely on — the app persists this in Expo SecureStore.
      return { accessToken, user, refreshToken };
    }
    res.cookie(this.cookieName, refreshToken, {
      ...this.cookieOptions,
      maxAge: this.refreshMaxAgeMs,
    });
    return { accessToken, user };
  }
}
