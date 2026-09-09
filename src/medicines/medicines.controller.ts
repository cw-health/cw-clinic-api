import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Tenant } from '../auth/decorators/tenant.decorator';
import type { TenantContext } from '../auth/guards/tenant.guard';
import { requireClinicId } from '../common/require-clinic-id.util';
import { CreateMedicineDto } from './dto/create-medicine.dto';
import { QueryMedicinesDto } from './dto/query-medicines.dto';
import { UpdateMedicineDto } from './dto/update-medicine.dto';
import { MedicinesService } from './medicines.service';

@ApiTags('medicines')
@ApiBearerAuth()
@Controller({ path: 'medicines', version: '1' })
export class MedicinesController {
  constructor(private readonly medicinesService: MedicinesService) {}

  @Post()
  @RequirePermissions('medicines:manage')
  async create(@Tenant() tenant: TenantContext, @Body() dto: CreateMedicineDto) {
    return this.medicinesService.create(requireClinicId(tenant), dto);
  }

  @Get()
  @RequirePermissions('medicines:read')
  async findAll(@Tenant() tenant: TenantContext, @Query() query: QueryMedicinesDto) {
    return this.medicinesService.findAll(requireClinicId(tenant), query);
  }

  @Get(':id')
  @RequirePermissions('medicines:read')
  async findById(@Tenant() tenant: TenantContext, @Param('id') id: string) {
    return this.medicinesService.findById(requireClinicId(tenant), id);
  }

  @Patch(':id')
  @RequirePermissions('medicines:manage')
  async update(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateMedicineDto,
  ) {
    return this.medicinesService.update(requireClinicId(tenant), id, dto);
  }
}
