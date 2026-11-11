import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { FremworkExceptionFilter } from './common/filters/http-exception.filter';
import { configErrors, configWarnings, isAllowedOrigin, loadConfig } from './config/env';

async function bootstrap() {
  const logger = new Logger('FremworkBootstrap');

  // Production safety check: the API serves real financial data, so it refuses to start unless it
  // can authenticate users with Supabase and read their data under row level security.
  const config = loadConfig();
  const errors = configErrors(config);
  if (errors.length) {
    const message = `Fremwork API configuration is invalid:\n  - ${errors.join('\n  - ')}`;
    if (config.production) throw new Error(message);
    logger.warn(`${message}\nAuthenticated routes will reject requests until this is fixed.`);
  }
  for (const warning of configWarnings(config)) logger.warn(warning);

  const app = await NestFactory.create(AppModule);
  // Render (and most hosts) terminate TLS at a proxy; trust its X-Forwarded-* headers.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.enableShutdownHooks();

  // Every route lives under /v1 except the index, docs index and the load-balancer health checks.
  app.setGlobalPrefix('v1', { exclude: ['/', 'v1', 'api/health', 'api/health/ready'] });

  app.enableCors({
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin, config)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Workspace-Id'],
    maxAge: 600,
  });

  app.useGlobalFilters(new FremworkExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));

  const docConfig = new DocumentBuilder()
    .setTitle('Fremwork API')
    .setDescription('Fremwork financial workspace and AI assistant. Authenticate with a Supabase access token: `Authorization: Bearer <token>`.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('v1/docs', app, SwaggerModule.createDocument(app, docConfig), {
    customCssUrl: 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui.min.css',
    customJs: [
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui-bundle.js',
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui-standalone-preset.js',
    ],
    swaggerOptions: { persistAuthorization: true },
  });

  // 0.0.0.0 so the platform's router can reach the container; Render sets PORT.
  await app.listen(config.port, '0.0.0.0');
  logger.log(`Fremwork API listening on 0.0.0.0:${config.port} (${config.production ? 'production' : 'development'})`);
  logger.log(`CORS origins: ${config.corsOrigins.join(', ')}`);
}

bootstrap().catch((err) => {
  new Logger('FremworkBootstrap').error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
