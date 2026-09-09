import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Tenant } from '../auth/decorators/tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/guards/tenant.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  AuditContext,
  type AuditRequestContext,
} from '../common/decorators/audit-context.decorator';
import { requireClinicId } from '../common/require-clinic-id.util';
import { CreateDispenseDto } from './dto/create-dispense.dto';
import { QueryDispensesDto } from './dto/query-dispenses.dto';
import { DispensingService } from './dispensing.service';

/** The Dispensing layer — see DispensingService's doc comment. */
@ApiTags('pharmacy')
@ApiBearerAuth()
@Controller({ path: 'pharmacy/dispenses', version: '1' })
export class DispensingController {
  constructor(private readonly dispensingService: DispensingService) {}

  @Post()
  @RequirePermissions('pharmacy:dispense-create')
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateDispenseDto,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.dispensingService.create(requireClinicId(tenant), user.sub, dto, auditCtx);
  }

  @Get()
  @RequirePermissions('pharmacy:dispense-read')
  async findAll(@Tenant() tenant: TenantContext, @Query() query: QueryDispensesDto) {
    return this.dispensingService.findAll(requireClinicId(tenant), query);
  }

  @Get(':id')
  @RequirePermissions('pharmacy:dispense-read')
  async findById(@Tenant() tenant: TenantContext, @Param('id') id: string) {
    return this.dispensingService.findById(requireClinicId(tenant), id);
  }
}
