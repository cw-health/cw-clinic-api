import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreatePlanDto } from './dto/create-plan.dto';
import { QueryPlansDto } from './dto/query-plans.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { PlansService } from './plans.service';

/**
 * Super Admin subscription-plan catalog (SA-06,
 * docs/SUPER_ADMIN_ARCHITECTURE.md §6.5/§9) — new module, mirroring
 * PlatformUsersAdminController's shape (SA-04): a dedicated admin
 * controller, `super-admin:plans-read` for read access and
 * `super-admin:plans-manage` for every mutation (create/update/
 * activate/deactivate) — both permission keys were already seeded in
 * SA-01, no new permission keys added here.
 */
@ApiTags('super-admin-plans')
@ApiBearerAuth()
@Controller({ path: 'super-admin/plans', version: '1' })
export class PlansAdminController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  @RequirePermissions('super-admin:plans-read')
  async list(@Query() query: QueryPlansDto) {
    return this.plansService.listPlans(query);
  }

  @Get(':id')
  @RequirePermissions('super-admin:plans-read')
  async findOne(@Param('id') id: string) {
    return this.plansService.getPlanById(id);
  }

  @Post()
  @RequirePermissions('super-admin:plans-manage')
  async create(@Body() dto: CreatePlanDto, @CurrentUser() user: JwtPayload) {
    return this.plansService.createPlan(dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('super-admin:plans-manage')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.plansService.updatePlan(id, dto, user.sub);
  }

  @Post(':id/activate')
  @RequirePermissions('super-admin:plans-manage')
  async activate(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.plansService.activatePlan(id, user.sub);
  }

  @Post(':id/deactivate')
  @RequirePermissions('super-admin:plans-manage')
  async deactivate(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.plansService.deactivatePlan(id, user.sub);
  }
}
