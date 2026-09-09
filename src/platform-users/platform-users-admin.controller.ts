import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreatePlatformUserDto } from './dto/create-platform-user.dto';
import { QueryPlatformUsersDto } from './dto/query-platform-users.dto';
import { UpdatePlatformUserDto } from './dto/update-platform-user.dto';
import { PlatformUsersService } from './platform-users.service';

/**
 * Super Admin platform-user CRUD + activate/deactivate (SA-04), mirroring
 * ClinicsAdminController's shape (SA-03): a dedicated admin controller in
 * its own module, reusing the existing `User` model rather than a second
 * identity table, per docs/SUPER_ADMIN_ARCHITECTURE.md §6.4.
 */
@ApiTags('super-admin-platform-users')
@ApiBearerAuth()
@Controller({ path: 'super-admin/platform-users', version: '1' })
export class PlatformUsersAdminController {
  constructor(private readonly platformUsersService: PlatformUsersService) {}

  @Get()
  @RequirePermissions('super-admin:platform-users-read')
  async list(@Query() query: QueryPlatformUsersDto) {
    return this.platformUsersService.listPlatformUsers(query);
  }

  @Get(':id')
  @RequirePermissions('super-admin:platform-users-read')
  async findOne(@Param('id') id: string) {
    return this.platformUsersService.getPlatformUserById(id);
  }

  @Post()
  @RequirePermissions('super-admin:platform-users-create')
  async create(@Body() dto: CreatePlatformUserDto, @CurrentUser() user: JwtPayload) {
    return this.platformUsersService.createPlatformUser(dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('super-admin:platform-users-update')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePlatformUserDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.platformUsersService.updatePlatformUser(id, dto, user.sub);
  }

  @Post(':id/activate')
  @RequirePermissions('super-admin:platform-users-update')
  async activate(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.platformUsersService.activatePlatformUser(id, user.sub);
  }

  @Post(':id/deactivate')
  @RequirePermissions('super-admin:platform-users-update')
  async deactivate(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.platformUsersService.deactivatePlatformUser(id, user.sub);
  }
}
