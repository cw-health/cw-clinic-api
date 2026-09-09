import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  DiskHealthIndicator,
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaHealthIndicator } from './indicators/prisma-health.indicator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
  ) {}

  // Liveness/readiness probe — infra checks this without a token, so it
  // must stay exempt from the global JwtAuthGuard.
  @Public()
  @Get('/live')
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.prismaIndicator.check('database'),
      () => this.memory.checkHeap('memoryHeap', 1024 * 1024 * 1024),
      () =>
        this.disk.checkStorage('diskStorage', {
          // check-disk-space requires a drive-letter path on Windows
          // (e.g. iisnode/Plesk) and a POSIX path elsewhere.
          path: process.platform === 'win32' ? 'C:\\' : '/',
          thresholdPercent: 0.9,
        }),
    ]);
  }
}
