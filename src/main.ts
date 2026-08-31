import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const configService = app.get(ConfigService<AppConfig, true>);

  app.use(helmet());
  app.enableCors({
    origin: configService.get('corsOrigins', { infer: true }),
    credentials: true,
  });

  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (
    configService.get('apiDocsEnabled', { infer: true }) &&
    configService.get('nodeEnv', { infer: true }) !== 'production'
  ) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('CW-CLINIC API')
      .setDescription('Backend API for CW-CLINIC — a multi-tenant clinic management platform.')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  // PORT may be a plain TCP port number (local dev, Docker, CI, future
  // Linux) or a named-pipe path assigned by iisnode on Windows Plesk (e.g.
  // "\\.\pipe\..."). Node's net.Server#listen() treats ANY string argument
  // as a pipe/socket path, so a numeric string has to be converted to an
  // actual Number to bind as a real TCP port.
  const rawPort = configService.get('port', { infer: true });
  const port = /^\d+$/.test(rawPort) ? Number(rawPort) : rawPort;
  await app.listen(port);
}

void bootstrap();
