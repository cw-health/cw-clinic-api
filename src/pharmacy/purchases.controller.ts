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
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { QueryPurchasesDto } from './dto/query-purchases.dto';
import { PurchasesService } from './purchases.service';

/** The Purchase layer — see PurchasesService's doc comment. */
@ApiTags('pharmacy')
@ApiBearerAuth()
@Controller({ path: 'pharmacy/purchases', version: '1' })
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Post()
  @RequirePermissions('pharmacy:purchases-create')
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePurchaseDto,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.purchasesService.create(requireClinicId(tenant), user.sub, dto, auditCtx);
  }

  @Get()
  @RequirePermissions('pharmacy:purchases-read')
  async findAll(@Tenant() tenant: TenantContext, @Query() query: QueryPurchasesDto) {
    return this.purchasesService.findAll(requireClinicId(tenant), query);
  }

  @Get(':id')
  @RequirePermissions('pharmacy:purchases-read')
  async findById(@Tenant() tenant: TenantContext, @Param('id') id: string) {
    return this.purchasesService.findById(requireClinicId(tenant), id);
  }
}
