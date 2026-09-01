"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const throttler_1 = require("@nestjs/throttler");
const core_1 = require("@nestjs/core");
const nestjs_pino_1 = require("nestjs-pino");
const node_crypto_1 = require("node:crypto");
const configuration_1 = __importDefault(require("./config/configuration"));
const env_validation_1 = require("./config/env.validation");
const prisma_module_1 = require("./prisma/prisma.module");
const health_module_1 = require("./health/health.module");
const all_exceptions_filter_1 = require("./common/filters/all-exceptions.filter");
const request_id_middleware_1 = require("./common/middleware/request-id.middleware");
let AppModule = class AppModule {
    configure(consumer) {
        consumer.apply(request_id_middleware_1.RequestIdMiddleware).forRoutes('*');
    }
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                load: [configuration_1.default],
                validate: env_validation_1.validateEnvironment,
            }),
            nestjs_pino_1.LoggerModule.forRootAsync({
                inject: [config_1.ConfigService],
                useFactory: (configService) => {
                    const nodeEnv = configService.get('nodeEnv', { infer: true });
                    return {
                        pinoHttp: {
                            level: configService.get('logLevel', { infer: true }),
                            genReqId: (req) => req.headers['x-request-id'] ?? (0, node_crypto_1.randomUUID)(),
                            customProps: (req) => ({
                                requestId: req.headers['x-request-id'],
                            }),
                            serializers: {
                                req: (req) => ({
                                    id: req.id,
                                    method: req.method,
                                    url: req.url,
                                }),
                                res: (res) => ({
                                    statusCode: res.statusCode,
                                }),
                            },
                            transport: nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
                        },
                    };
                },
            }),
            throttler_1.ThrottlerModule.forRootAsync({
                inject: [config_1.ConfigService],
                useFactory: (configService) => [
                    {
                        ttl: configService.get('throttle', { infer: true }).ttlMs,
                        limit: configService.get('throttle', { infer: true }).limit,
                    },
                ],
            }),
            prisma_module_1.PrismaModule,
            health_module_1.HealthModule,
        ],
        providers: [
            { provide: core_1.APP_FILTER, useClass: all_exceptions_filter_1.AllExceptionsFilter },
            { provide: core_1.APP_GUARD, useClass: throttler_1.ThrottlerGuard },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map