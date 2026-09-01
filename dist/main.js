"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const core_1 = require("@nestjs/core");
const swagger_1 = require("@nestjs/swagger");
const helmet_1 = __importDefault(require("helmet"));
const nestjs_pino_1 = require("nestjs-pino");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { bufferLogs: true });
    app.useLogger(app.get(nestjs_pino_1.Logger));
    const configService = app.get((config_1.ConfigService));
    app.use((0, helmet_1.default)());
    app.enableCors({
        origin: configService.get('corsOrigins', { infer: true }),
        credentials: true,
    });
    app.setGlobalPrefix('api');
    app.enableVersioning({
        type: common_1.VersioningType.URI,
        defaultVersion: '1',
    });
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
    }));
    if (configService.get('apiDocsEnabled', { infer: true }) &&
        configService.get('nodeEnv', { infer: true }) !== 'production') {
        const swaggerConfig = new swagger_1.DocumentBuilder()
            .setTitle('CW-CLINIC API')
            .setDescription('Backend API for CW-CLINIC — a multi-tenant clinic management platform.')
            .setVersion('1.0')
            .addBearerAuth()
            .build();
        const document = swagger_1.SwaggerModule.createDocument(app, swaggerConfig);
        swagger_1.SwaggerModule.setup('api/docs', app, document);
    }
    const rawPort = configService.get('port', { infer: true });
    const port = /^\d+$/.test(rawPort) ? Number(rawPort) : rawPort;
    await app.listen(port);
}
void bootstrap();
//# sourceMappingURL=main.js.map