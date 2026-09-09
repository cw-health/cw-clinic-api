import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Tenant } from '../auth/decorators/tenant.decorator';
import type { TenantContext } from '../auth/guards/tenant.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { requireClinicId } from '../common/require-clinic-id.util';
import { CreateStaffDto } from './dto/create-staff.dto';
import { QueryStaffDto } from './dto/query-staff.dto';
import { StaffService } from './staff.service';
import {
  AssignStaffBranchDto,
  AssignStaffDepartmentDto,
  AssignStaffRoleDto,
  UpdateStaffDto,
  UpdateStaffStatusDto,
} from './dto/update-staff.dto';

/**
 * Hospital Staff / User Management (Phase 1D). ClinicAdmin-only, tenant-
 * isolated exactly like Doctors/Branches/Departments — every method reads
 * `clinicId` from the caller's resolved TenantContext, never the request
 * body (docs/SECURITY.md §4). Permission keys reuse the existing `users:*`
 * category already seeded for ClinicAdmin (docs/RBAC.md §2) rather than
 * minting a new namespace: "staff" is this feature's name, `users:*` is
 * the RBAC-architecture permission it enforces.
 */
@ApiTags('staff')
@ApiBearerAuth()
@Controller({ path: 'staff', version: '1' })
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  // Declared ahead of the ':id' routes so Nest doesn't match "roles" as :id.
  @Get('roles')
  @RequirePermissions('users:read')
  async listAssignableRoles(@Tenant() tenant: TenantContext) {
    return this.staffService.listAssignableRoles(requireClinicId(tenant));
  }

  @Post()
  @RequirePermissions('users:create')
  async invite(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateStaffDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.staffService.invite(requireClinicId(tenant), dto, user.sub);
  }

  @Get()
  @RequirePermissions('users:read')
  async findAll(@Tenant() tenant: TenantContext, @Query() query: QueryStaffDto) {
    return this.staffService.findAll(requireClinicId(tenant), query);
  }

  @Get(':id')
  @RequirePermissions('users:read')
  async findById(@Tenant() tenant: TenantContext, @Param('id') id: string) {
    return this.staffService.findById(requireClinicId(tenant), id);
  }

  @Patch(':id')
  @RequirePermissions('users:update')
  async update(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.staffService.update(requireClinicId(tenant), id, dto, user.sub);
  }

  @Patch(':id/role')
  @RequirePermissions('users:update')
  async assignRole(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: AssignStaffRoleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.staffService.assignRole(requireClinicId(tenant), id, dto.roleId, user.sub);
  }

  @Patch(':id/branch')
  @RequirePermissions('users:update')
  async assignBranch(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: AssignStaffBranchDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.staffService.assignBranch(requireClinicId(tenant), id, dto.branchId, user.sub);
  }

  @Patch(':id/department')
  @RequirePermissions('users:update')
  async assignDepartment(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: AssignStaffDepartmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.staffService.assignDepartment(
      requireClinicId(tenant),
      id,
      dto.departmentId,
      user.sub,
    );
  }

  @Patch(':id/status')
  @RequirePermissions('users:update')
  async updateStatus(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateStaffStatusDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.staffService.updateStatus(requireClinicId(tenant), id, dto.status, user.sub);
  }

  @Post(':id/resend-invite')
  @RequirePermissions('users:create')
  async resendInvite(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.staffService.resendInvite(requireClinicId(tenant), id, user.sub);
  }

  @Post(':id/revoke-access')
  @RequirePermissions('users:delete')
  async revokeAccess(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.staffService.revokeAccess(requireClinicId(tenant), id, user.sub);
  }
}
