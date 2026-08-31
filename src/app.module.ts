import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import configuration, { AppConfig } from './config/configuration';
import { validateEnvironment } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnvironment,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const nodeEnv = configService.get('nodeEnv', { infer: true });
        return {
          pinoHttp: {
            level: configService.get('logLevel', { infer: true }),
            genReqId: (req: { headers: Record<string, unknown> }) =>
              (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
            customProps: (req: { headers: Record<string, unknown> }) => ({
              requestId: req.headers['x-request-id'],
            }),
            // Never log request/response bodies — docs/SECURITY.md §8 forbids
            // logging patient PII/PHI or full request/response bodies.
            serializers: {
              req: (req: Record<string, unknown>) => ({
                id: req.id,
                method: req.method,
                url: req.url,
              }),
              res: (res: Record<string, unknown>) => ({
                statusCode: res.statusCode,
              }),
            },
            transport: nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
          },
        };
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => [
        {
          ttl: configService.get('throttle', { infer: true }).ttlMs,
          limit: configService.get('throttle', { infer: true }).limit,
        },
      ],
    }),
    PrismaModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
