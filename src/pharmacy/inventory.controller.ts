import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Tenant } from '../auth/decorators/tenant.decorator';
import type { TenantContext } from '../auth/guards/tenant.guard';
import { requireClinicId } from '../common/require-clinic-id.util';
import { QueryBatchesDto, QueryStockSummaryDto } from './dto/query-batches.dto';
import { InventoryService } from './inventory.service';

/** Read surface over the Inventory layer — see InventoryService's doc comment. */
@ApiTags('pharmacy')
@ApiBearerAuth()
@Controller({ path: 'pharmacy', version: '1' })
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('batches')
  @RequirePermissions('pharmacy:inventory-read')
  async findAllBatches(@Tenant() tenant: TenantContext, @Query() query: QueryBatchesDto) {
    return this.inventoryService.findAllBatches(requireClinicId(tenant), query);
  }

  @Get('batches/:id')
  @RequirePermissions('pharmacy:inventory-read')
  async findBatchById(@Tenant() tenant: TenantContext, @Param('id') id: string) {
    return this.inventoryService.findBatchById(requireClinicId(tenant), id);
  }

  @Get('stock-summary')
  @RequirePermissions('pharmacy:inventory-read')
  async findStockSummary(@Tenant() tenant: TenantContext, @Query() query: QueryStockSummaryDto) {
    return this.inventoryService.findStockSummary(requireClinicId(tenant), query);
  }
}
