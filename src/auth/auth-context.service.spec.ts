import { ForbiddenException } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthContextService } from './auth-context.service';

function makeService(prismaOverrides: Partial<Record<string, unknown>>) {
  const prisma = {
    role: { findFirst: jest.fn() },
    clinicMembership: { findFirst: jest.fn() },
    ...prismaOverrides,
  };

  return { service: new AuthContextService(prisma as unknown as PrismaService), prisma };
}

const baseUser = { id: 'user-1', isSuperAdmin: false } as User;

describe('AuthContextService', () => {
  it('resolves SuperAdmin permissions from the system SuperAdmin role, with no clinic context', async () => {
    const { service, prisma } = makeService({
      role: {
        findFirst: jest.fn().mockResolvedValue({
          rolePermissions: [
            { permission: { key: 'clinics:read' } },
            { permission: { key: 'clinics:create' } },
            { permission: { key: 'super-admin:clinics-read' } },
          ],
        }),
      },
    });

    const result = await service.resolve({ ...baseUser, isSuperAdmin: true });

    expect(result).toEqual({
      role: 'SuperAdmin',
      clinicId: null,
      clinicName: null,
      permissions: ['clinics:read', 'clinics:create', 'super-admin:clinics-read'],
    });
    expect(prisma.clinicMembership.findFirst).not.toHaveBeenCalled();
  });

  it('throws when a non-SuperAdmin user has no active clinic membership', async () => {
    const { service, prisma } = makeService({
      clinicMembership: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    void prisma;
    await expect(service.resolve(baseUser)).rejects.toThrow(ForbiddenException);
  });

  it('resolves role/clinic/permissions from the active membership', async () => {
    const { service } = makeService({
      clinicMembership: {
        findFirst: jest.fn().mockResolvedValue({
          clinicId: 'clinic-1',
          clinic: { name: 'Dev Clinic' },
          role: {
            name: 'Doctor',
            rolePermissions: [{ permission: { key: 'appointments:read' } }],
          },
        }),
      },
    });

    const result = await service.resolve(baseUser);

    expect(result).toEqual({
      role: 'Doctor',
      clinicId: 'clinic-1',
      clinicName: 'Dev Clinic',
      permissions: ['appointments:read'],
    });
  });

  it('pins resolution to a preferred clinicId (e.g. the clinic a refresh token was issued for)', async () => {
    const { service, prisma } = makeService({
      clinicMembership: {
        findFirst: jest.fn().mockResolvedValue({
          clinicId: 'clinic-2',
          clinic: { name: 'Second Clinic' },
          role: { name: 'FrontDesk', rolePermissions: [] },
        }),
      },
    });

    await service.resolve(baseUser, 'clinic-2');

    expect(prisma.clinicMembership.findFirst).toHaveBeenCalledWith(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock, loosely typed by design
      expect.objectContaining({ where: expect.objectContaining({ clinicId: 'clinic-2' }) }),
    );
  });
});
