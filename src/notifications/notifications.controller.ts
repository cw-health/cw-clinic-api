import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Tenant } from '../auth/decorators/tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/guards/tenant.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { requireClinicId } from '../common/require-clinic-id.util';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('me')
  @RequirePermissions('notifications:read-own')
  async findOwn(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryNotificationsDto,
  ) {
    const clinicId = requireClinicId(tenant);
    return this.notificationsService.findOwn(clinicId, user.sub, query);
  }

  // Declared ahead of the ':id/read' route below so Nest doesn't match
  // "unread-count" as an :id param — mirrors invoices.controller.ts's
  // 'me'/'revenue-summary' ordering comment.
  @Get('me/unread-count')
  @RequirePermissions('notifications:read-own')
  async unreadCount(@Tenant() tenant: TenantContext, @CurrentUser() user: JwtPayload) {
    const clinicId = requireClinicId(tenant);
    return this.notificationsService.unreadCount(clinicId, user.sub);
  }

  @Post(':id/read')
  @RequirePermissions('notifications:read-own')
  async markRead(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const clinicId = requireClinicId(tenant);
    return this.notificationsService.markRead(clinicId, user.sub, id);
  }

  @Post('read-all')
  @RequirePermissions('notifications:read-own')
  async markAllRead(@Tenant() tenant: TenantContext, @CurrentUser() user: JwtPayload) {
    const clinicId = requireClinicId(tenant);
    return this.notificationsService.markAllRead(clinicId, user.sub);
  }

  /**
   * Push-delivery target registration (docs/DECISIONS.md ADR-008) — called
   * by the mobile client after the user grants notification permission.
   * Self-scoped (@CurrentUser, not the request body) — no clinicId
   * dimension, see UserDeviceToken's doc comment in schema.prisma.
   */
  @Post('device-tokens')
  @RequirePermissions('notifications:read-own')
  async registerDeviceToken(@CurrentUser() user: JwtPayload, @Body() dto: RegisterDeviceTokenDto) {
    await this.notificationsService.registerDeviceToken(user.sub, dto);
  }

  @Delete('device-tokens/:token')
  @RequirePermissions('notifications:read-own')
  async unregisterDeviceToken(@CurrentUser() user: JwtPayload, @Param('token') token: string) {
    await this.notificationsService.unregisterDeviceToken(user.sub, token);
  }
}
