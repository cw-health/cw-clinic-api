import { BadRequestException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { InventoryService } from './inventory.service';
import type { PrismaService } from '../prisma/prisma.service';
import { StockMovementsService } from './stock-movements.service';

const baseBatch = {
  id: 'batch-1',
  clinicId: 'clinic-a',
  branchId: null,
  medicineId: 'medicine-1',
  batchNumber: 'B001',
  quantityOnHand: 10,
};

const baseMovement = {
  id: 'movement-1',
  clinicId: 'clinic-a',
  branchId: null,
  medicineId: 'medicine-1',
  batchId: 'batch-1',
  type: 'ADJUSTMENT',
  quantity: -3,
  quantityBefore: 10,
  quantityAfter: 7,
  referenceType: 'MANUAL',
  referenceId: null,
  reason: 'Stock count correction',
  performedByUserId: 'user-pharmacist',
  createdAt: new Date(),
  medicine: { name: 'Paracetamol' },
  batch: { batchNumber: 'B001' },
};

function makeService() {
  const prisma = {
    medicineBatch: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    stockMovement: {
      create: jest
        .fn<Promise<typeof baseMovement>, [{ data: Record<string, unknown> }]>()
        .mockResolvedValue(baseMovement),
      findFirst: jest.fn().mockResolvedValue(baseMovement),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: undefined as unknown as (arg: unknown) => Promise<unknown>,
  };
  prisma.$transaction = jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(prisma);
    return Promise.all(arg as Promise<unknown>[]);
  });

  const inventoryService = {
    findBatchForWrite: jest.fn().mockResolvedValue(baseBatch),
  };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new StockMovementsService(
    prisma as unknown as PrismaService,
    inventoryService as unknown as InventoryService,
    auditService as unknown as AuditService,
  );

  return { service, prisma, inventoryService, auditService };
}

describe('StockMovementsService', () => {
  describe('create', () => {
    it('rejects RETURN with direction OUT', async () => {
      const { service } = makeService();
      await expect(
        service.create('clinic-a', 'user-pharmacist', {
          batchId: 'batch-1',
          type: 'RETURN',
          direction: 'OUT',
          quantity: 2,
          reason: 'Patient returned unused strip',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects EXPIRED with direction IN', async () => {
      const { service } = makeService();
      await expect(
        service.create('clinic-a', 'user-pharmacist', {
          batchId: 'batch-1',
          type: 'EXPIRED',
          direction: 'IN',
          quantity: 2,
          reason: 'Batch past expiry',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a movement that would leave the batch negative', async () => {
      const { service } = makeService();
      await expect(
        service.create('clinic-a', 'user-pharmacist', {
          batchId: 'batch-1',
          type: 'DAMAGED',
          direction: 'OUT',
          quantity: 999,
          reason: 'Water damage',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('applies a negative delta for an OUT movement and records the ledger row', async () => {
      const { service, prisma, auditService } = makeService();

      await service.create('clinic-a', 'user-pharmacist', {
        batchId: 'batch-1',
        type: 'ADJUSTMENT',
        direction: 'OUT',
        quantity: 3,
        reason: 'Stock count correction',
      });

      expect(prisma.medicineBatch.updateMany).toHaveBeenCalledWith({
        where: { id: 'batch-1', clinicId: 'clinic-a' },
        data: { quantityOnHand: 7 },
      });
      const [[stockMovementCreateArgs]] = prisma.stockMovement.create.mock.calls;
      expect(stockMovementCreateArgs.data).toMatchObject({
        quantity: -3,
        quantityBefore: 10,
        quantityAfter: 7,
        referenceType: 'MANUAL',
      });
      expect(auditService.record).toHaveBeenCalled();
    });

    it('applies a positive delta for an IN movement', async () => {
      const { service, prisma } = makeService();

      await service.create('clinic-a', 'user-pharmacist', {
        batchId: 'batch-1',
        type: 'RETURN',
        direction: 'IN',
        quantity: 5,
        reason: 'Unused units returned',
      });

      expect(prisma.medicineBatch.updateMany).toHaveBeenCalledWith({
        where: { id: 'batch-1', clinicId: 'clinic-a' },
        data: { quantityOnHand: 15 },
      });
    });
  });
});
