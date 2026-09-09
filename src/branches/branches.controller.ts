import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Tenant } from '../auth/decorators/tenant.decorator';
import type { TenantContext } from '../auth/guards/tenant.guard';
import { requireClinicId } from '../common/require-clinic-id.util';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { QueryBranchesDto } from './dto/query-branches.dto';
import { UpdateBranchDto, UpdateBranchStatusDto } from './dto/update-branch.dto';

/** Branch Management (Phase 1B) — ClinicAdmin-only, tenant-isolated per docs/DECISIONS.md ADR-009. */
@ApiTags('branches')
@ApiBearerAuth()
@Controller({ path: 'branches', version: '1' })
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Post()
  @RequirePermissions('branches:create')
  async create(@Tenant() tenant: TenantContext, @Body() dto: CreateBranchDto) {
    return this.branchesService.create(requireClinicId(tenant), dto);
  }

  @Get()
  @RequirePermissions('branches:read')
  async findAll(@Tenant() tenant: TenantContext, @Query() query: QueryBranchesDto) {
    return this.branchesService.findAll(requireClinicId(tenant), query);
  }

  @Get(':id')
  @RequirePermissions('branches:read')
  async findById(@Tenant() tenant: TenantContext, @Param('id') id: string) {
    return this.branchesService.findById(requireClinicId(tenant), id);
  }

  @Patch(':id')
  @RequirePermissions('branches:update')
  async update(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branchesService.update(requireClinicId(tenant), id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions('branches:update')
  async updateStatus(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateBranchStatusDto,
  ) {
    return this.branchesService.updateStatus(requireClinicId(tenant), id, dto.status);
  }

  @Post(':id/archive')
  @RequirePermissions('branches:archive')
  async archive(@Tenant() tenant: TenantContext, @Param('id') id: string) {
    return this.branchesService.archive(requireClinicId(tenant), id);
  }
}
