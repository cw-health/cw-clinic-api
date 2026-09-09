/**
 * Shape returned to the client — deliberately excludes `passwordHash` and
 * any other authentication secret (docs/SECURITY.md §9). Every Prisma
 * query in PlatformUsersService selects exactly this field set, never a
 * bare `findMany`/`findUnique` on User, so a secret can't leak by omission
 * here going stale relative to the schema.
 */
export interface PlatformUserResponseDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: string;
  isSuperAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const PLATFORM_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  status: true,
  isSuperAdmin: true,
  createdAt: true,
  updatedAt: true,
} as const;
