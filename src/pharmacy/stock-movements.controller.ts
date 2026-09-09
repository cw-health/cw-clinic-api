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
import { CreateStockMovementDto } from './dto/create-stock-movement.dto';
import { QueryStockMovementsDto } from './dto/query-stock-movements.dto';
import { StockMovementsService } from './stock-movements.service';

/** The Stock ledger — see StockMovementsService's doc comment. */
@ApiTags('pharmacy')
@ApiBearerAuth()
@Controller({ path: 'pharmacy/stock-movements', version: '1' })
export class StockMovementsController {
  constructor(private readonly stockMovementsService: StockMovementsService) {}

  @Post()
  @RequirePermissions('pharmacy:inventory-manage')
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateStockMovementDto,
    @AuditContext() auditCtx: AuditRequestContext,
  ) {
    return this.stockMovementsService.create(requireClinicId(tenant), user.sub, dto, auditCtx);
  }

  @Get()
  @RequirePermissions('pharmacy:inventory-read')
  async findAll(@Tenant() tenant: TenantContext, @Query() query: QueryStockMovementsDto) {
    return this.stockMovementsService.findAll(requireClinicId(tenant), query);
  }

  @Get(':id')
  @RequirePermissions('pharmacy:inventory-read')
  async findById(@Tenant() tenant: TenantContext, @Param('id') id: string) {
    return this.stockMovementsService.findById(requireClinicId(tenant), id);
  }
}
