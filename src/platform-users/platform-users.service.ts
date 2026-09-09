import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import { hashPassword } from '../auth/password.util';
import { PrismaService } from '../prisma/prisma.service';
import type { CreatePlatformUserDto } from './dto/create-platform-user.dto';
import {
  PLATFORM_USER_SELECT,
  type PlatformUserResponseDto,
} from './dto/platform-user-response.dto';
import type { QueryPlatformUsersDto } from './dto/query-platform-users.dto';
import type { UpdatePlatformUserDto } from './dto/update-platform-user.dto';

/**
 * Super Admin platform-user management (SA-04,
 * docs/SUPER_ADMIN_ARCHITECTURE.md §6.4). A platform user is an existing
 * `User` row with `isSuperAdmin: true` — there is no separate identity
 * table. Every query here is scoped to `isSuperAdmin: true` so a regular
 * tenant/clinic user is never listed, edited, or activated/deactivated
 * through this surface, and every Prisma read selects exactly
 * `PLATFORM_USER_SELECT` so `passwordHash` never reaches a response
 * (docs/SECURITY.md §9).
 */
@Injectable()
export class PlatformUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listPlatformUsers(
    query: QueryPlatformUsersDto,
  ): Promise<PaginatedResult<PlatformUserResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.UserWhereInput = {
      isSuperAdmin: true,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search } },
              { lastName: { contains: query.search } },
              { email: { contains: query.search } },
            ],
          }
        : {}),
    };

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';
    const orderBy: Prisma.UserOrderByWithRelationInput[] =
      sortBy === 'name'
        ? [{ firstName: sortOrder }, { lastName: sortOrder }]
        : [{ createdAt: sortOrder }];

    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: PLATFORM_USER_SELECT,
      }),
    ]);

    return { data: users, meta: { total, page, pageSize } };
  }

  async getPlatformUserById(id: string): Promise<PlatformUserResponseDto> {
    const user = await this.prisma.user.findFirst({
      where: { id, isSuperAdmin: true },
      select: PLATFORM_USER_SELECT,
    });
    if (!user) throw new NotFoundException('Platform user not found');
    return user;
  }

  async createPlatformUser(
    dto: CreatePlatformUserDto,
    actorUserId: string,
  ): Promise<PlatformUserResponseDto> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('A user with this email already exists');

    const passwordHash = await hashPassword(dto.password);

    const user = await this.prisma.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        passwordHash,
        // Server-determined platform identity — never client input
        // (docs/SUPER_ADMIN_ARCHITECTURE.md §6.4). Authorization for the
        // account comes from AuthContextService resolving the SuperAdmin
        // system role for any isSuperAdmin user; no ClinicMembership or
        // roleId is ever assigned here.
        isSuperAdmin: true,
        status: 'ACTIVE',
      },
      select: PLATFORM_USER_SELECT,
    });

    await this.auditService.record({
      clinicId: null,
      actorUserId,
      actorType: 'PLATFORM_USER',
      entity: 'User',
      entityId: user.id,
      action: 'CREATE',
    });

    return user;
  }

  async updatePlatformUser(
    id: string,
    dto: UpdatePlatformUserDto,
    actorUserId: string,
  ): Promise<PlatformUserResponseDto> {
    await this.getPlatformUserById(id);

    if (dto.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (existing && existing.id !== id) {
        throw new ConflictException('A user with this email already exists');
      }
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: dto,
      select: PLATFORM_USER_SELECT,
    });

    await this.auditService.record({
      clinicId: null,
      actorUserId,
      actorType: 'PLATFORM_USER',
      entity: 'User',
      entityId: id,
      action: 'UPDATE',
      changedFields: Object.keys(dto).join(','),
    });

    return user;
  }

  async activatePlatformUser(id: string, actorUserId: string): Promise<PlatformUserResponseDto> {
    await this.getPlatformUserById(id);

    const user = await this.prisma.user.update({
      where: { id },
      data: { status: 'ACTIVE' },
      select: PLATFORM_USER_SELECT,
    });

    await this.auditService.record({
      clinicId: null,
      actorUserId,
      actorType: 'PLATFORM_USER',
      entity: 'User',
      entityId: id,
      action: 'ACTIVATE',
    });

    return user;
  }

  async deactivatePlatformUser(id: string, actorUserId: string): Promise<PlatformUserResponseDto> {
    if (id === actorUserId) {
      throw new ForbiddenException('You cannot deactivate your own account');
    }
    await this.getPlatformUserById(id);

    // Self-protection (SA-04 Task 9): never let the platform become
    // inaccessible by deactivating the last remaining active Super Admin.
    const otherActiveSuperAdmins = await this.prisma.user.count({
      where: { isSuperAdmin: true, status: 'ACTIVE', id: { not: id } },
    });
    if (otherActiveSuperAdmins === 0) {
      throw new ConflictException('Cannot deactivate the last active Super Admin');
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: { status: 'INACTIVE' },
      select: PLATFORM_USER_SELECT,
    });

    await this.auditService.record({
      clinicId: null,
      actorUserId,
      actorType: 'PLATFORM_USER',
      entity: 'User',
      entityId: id,
      action: 'DEACTIVATE',
    });

    return user;
  }
}
