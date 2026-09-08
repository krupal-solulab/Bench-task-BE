import 'reflect-metadata';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { writeFileSync } from 'fs';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const configService = app.get(ConfigService<AppConfig, true>);
  app.useLogger(app.get(Logger));

  const apiPrefix = configService.get('apiPrefix', { infer: true });
  app.setGlobalPrefix(apiPrefix);

  app.use(helmet());
  // CORS is intentionally wide open (not env-driven): the API is a public JSON
  // API authenticated via a Bearer token (no cookies), so there's no session to
  // leak by allowing any origin, and it avoids CORS_ORIGIN drift across deploys.
  app.enableCors({ origin: '*' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  if (configService.get('swaggerEnabled', { infer: true })) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Project & Task Management API')
      .setDescription('REST API for a Jira/Trello-style project and task management system')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);

    if (configService.get('nodeEnv', { infer: true }) !== 'production') {
      // Local-dev convenience only (keeps the committed openapi.json in sync while
      // iterating). Never let this take the app down - the working directory may
      // not be writable by the container's non-root user, and Swagger UI at
      // /api/docs doesn't depend on this file existing.
      try {
        writeFileSync('./openapi.json', JSON.stringify(document, null, 2));
      } catch (err) {
        app.get(Logger).warn({ err }, 'could not write openapi.json, skipping');
      }
    }
  }

  const port = configService.get('port', { infer: true });
  await app.listen(port);
}

void bootstrap();
