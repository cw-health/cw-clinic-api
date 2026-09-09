import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Tenant } from '../auth/decorators/tenant.decorator';
import type { TenantContext } from '../auth/guards/tenant.guard';
import { requireClinicId } from '../common/require-clinic-id.util';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { QueryDepartmentsDto } from './dto/query-departments.dto';
import { UpdateDepartmentDto, UpdateDepartmentStatusDto } from './dto/update-department.dto';

/** Department Management (Phase 1C) — ClinicAdmin-only, tenant-isolated (Clinic -> Branch -> Department). */
@ApiTags('departments')
@ApiBearerAuth()
@Controller({ path: 'departments', version: '1' })
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Post()
  @RequirePermissions('departments:create')
  async create(@Tenant() tenant: TenantContext, @Body() dto: CreateDepartmentDto) {
    return this.departmentsService.create(requireClinicId(tenant), dto);
  }

  @Get()
  @RequirePermissions('departments:read')
  async findAll(@Tenant() tenant: TenantContext, @Query() query: QueryDepartmentsDto) {
    return this.departmentsService.findAll(requireClinicId(tenant), query);
  }

  @Get(':id')
  @RequirePermissions('departments:read')
  async findById(@Tenant() tenant: TenantContext, @Param('id') id: string) {
    return this.departmentsService.findById(requireClinicId(tenant), id);
  }

  @Patch(':id')
  @RequirePermissions('departments:update')
  async update(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.departmentsService.update(requireClinicId(tenant), id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions('departments:update')
  async updateStatus(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentStatusDto,
  ) {
    return this.departmentsService.updateStatus(requireClinicId(tenant), id, dto.status);
  }

  @Post(':id/archive')
  @RequirePermissions('departments:archive')
  async archive(@Tenant() tenant: TenantContext, @Param('id') id: string) {
    return this.departmentsService.archive(requireClinicId(tenant), id);
  }
}
