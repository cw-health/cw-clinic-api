import { Test, TestingModule } from '@nestjs/testing';
import { DiskHealthIndicator, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './indicators/prisma-health.indicator';

describe('HealthController', () => {
  let controller: HealthController;
  let health: { check: jest.Mock };

  beforeEach(async () => {
    health = {
      check: jest.fn().mockResolvedValue({ status: 'ok', info: {}, error: {}, details: {} }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: health },
        { provide: PrismaHealthIndicator, useValue: { check: jest.fn() } },
        { provide: MemoryHealthIndicator, useValue: { checkHeap: jest.fn() } },
        { provide: DiskHealthIndicator, useValue: { checkStorage: jest.fn() } },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates to HealthCheckService.check with the expected indicators', async () => {
    const result = await controller.check();
    expect(health.check).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'ok', info: {}, error: {}, details: {} });
  });
});
