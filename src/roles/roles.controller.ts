import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Tenant } from '../auth/decorators/tenant.decorator';
import type { TenantContext } from '../auth/guards/tenant.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { requireClinicId } from '../common/require-clinic-id.util';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { QueryRolesDto } from './dto/query-roles.dto';
import { ArchiveRoleDto, UpdateRoleDto } from './dto/update-role.dto';
import { RolesService } from './roles.service';

/**
 * Clinic Role & Permission Management (Phase 1E, docs/RBAC.md §1-2).
 * ClinicAdmin-only, tenant-isolated exactly like Branches/Departments/
 * Staff — every method reads `clinicId` from the caller's resolved
 * TenantContext, never the request body (docs/SECURITY.md §4). Reuses the
 * existing `roles:*` permission category (already seeded for ClinicAdmin)
 * rather than minting a new namespace.
 */
@ApiTags('roles')
@ApiBearerAuth()
@Controller({ path: 'roles', version: '1' })
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  // Declared ahead of ':id' so Nest doesn't match "permissions" as :id.
  @Get('permissions/catalog')
  @RequirePermissions('roles:read')
  async getPermissionCatalog() {
    return this.rolesService.getPermissionCatalog();
  }

  @Get()
  @RequirePermissions('roles:read')
  async findAll(@Tenant() tenant: TenantContext, @Query() query: QueryRolesDto) {
    return this.rolesService.findAll(requireClinicId(tenant), query);
  }

  @Get(':id')
  @RequirePermissions('roles:read')
  async findById(@Tenant() tenant: TenantContext, @Param('id') id: string) {
    return this.rolesService.findById(requireClinicId(tenant), id);
  }

  @Get(':id/users')
  @RequirePermissions('roles:read')
  async listUsers(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.rolesService.listUsers(requireClinicId(tenant), id, query);
  }

  @Post()
  @RequirePermissions('roles:create')
  async create(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateRoleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.rolesService.create(requireClinicId(tenant), user.sub, dto);
  }

  @Patch(':id')
  @RequirePermissions('roles:update')
  async update(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.rolesService.update(requireClinicId(tenant), id, user.sub, dto);
  }

  // roles:delete gates archiving (a soft, one-way deactivation, docs/roles.service.ts)
  // rather than a hard delete — no permission key is minted just for this.
  @Post(':id/archive')
  @RequirePermissions('roles:delete')
  async archive(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: ArchiveRoleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.rolesService.archive(requireClinicId(tenant), id, user.sub, dto);
  }
}
