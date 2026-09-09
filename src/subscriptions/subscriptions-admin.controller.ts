import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AssignSubscriptionDto } from './dto/assign-subscription.dto';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { ChangePlanDto } from './dto/change-plan.dto';
import { QuerySubscriptionsDto } from './dto/query-subscriptions.dto';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Super Admin clinic-subscription management (SA-07,
 * docs/SUPER_ADMIN_ARCHITECTURE.md §6.6/§9) — new module, mirroring
 * PlansAdminController's shape: `super-admin:subscriptions-read` for read
 * access, `super-admin:subscriptions-manage` for every mutation. Routes are
 * addressed by `:clinicId` (not `:id`) so `TenantGuard`'s route-param check
 * applies the same way it does on every other clinic-nested resource.
 */
@ApiTags('super-admin-subscriptions')
@ApiBearerAuth()
@Controller({ path: 'super-admin/subscriptions', version: '1' })
export class SubscriptionsAdminController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get()
  @RequirePermissions('super-admin:subscriptions-read')
  async list(@Query() query: QuerySubscriptionsDto) {
    return this.subscriptionsService.listCurrentSubscriptions(query);
  }

  @Get(':clinicId')
  @RequirePermissions('super-admin:subscriptions-read')
  async getCurrent(@Param('clinicId') clinicId: string) {
    return this.subscriptionsService.getCurrentSubscription(clinicId);
  }

  @Get(':clinicId/history')
  @RequirePermissions('super-admin:subscriptions-read')
  async getHistory(@Param('clinicId') clinicId: string) {
    return this.subscriptionsService.getSubscriptionHistory(clinicId);
  }

  @Post(':clinicId')
  @RequirePermissions('super-admin:subscriptions-manage')
  async assign(
    @Param('clinicId') clinicId: string,
    @Body() dto: AssignSubscriptionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.subscriptionsService.assignSubscription(clinicId, dto, user.sub);
  }

  @Patch(':clinicId/plan')
  @RequirePermissions('super-admin:subscriptions-manage')
  async changePlan(
    @Param('clinicId') clinicId: string,
    @Body() dto: ChangePlanDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.subscriptionsService.changePlan(clinicId, dto, user.sub);
  }

  @Post(':clinicId/activate')
  @RequirePermissions('super-admin:subscriptions-manage')
  async activate(@Param('clinicId') clinicId: string, @CurrentUser() user: JwtPayload) {
    return this.subscriptionsService.activateSubscription(clinicId, user.sub);
  }

  @Post(':clinicId/deactivate')
  @RequirePermissions('super-admin:subscriptions-manage')
  async deactivate(@Param('clinicId') clinicId: string, @CurrentUser() user: JwtPayload) {
    return this.subscriptionsService.deactivateSubscription(clinicId, user.sub);
  }

  @Post(':clinicId/cancel')
  @RequirePermissions('super-admin:subscriptions-manage')
  async cancel(
    @Param('clinicId') clinicId: string,
    @Body() dto: CancelSubscriptionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.subscriptionsService.cancelSubscription(clinicId, dto, user.sub);
  }
}
