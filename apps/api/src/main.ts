import 'dotenv/config';
import { ConsoleLogger, INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser = require('cookie-parser');
import helmet from 'helmet';
import { AppModule } from './app.module';
import { mountOpenApi } from './openapi';
import { hostOf, TenantRegistry } from './tenancy/tenant-registry';

/** Browser origins allowed to call the API with credentials (from WEB_ORIGIN). */
export function allowedOrigins(): string[] | true {
  const raw = process.env.WEB_ORIGIN?.trim();
  if (raw) return raw.split(',').map((o) => o.trim()).filter(Boolean);
  if (process.env.NODE_ENV === 'production') {
    throw new Error('WEB_ORIGIN must be set in production (comma-separate several origins).');
  }
  return true; // development: reflect the caller's origin
}

/** Middleware and pipes shared by the server and the integration tests. */
export function configureApp(app: INestApplication): void {
  const express = app as NestExpressApplication;
  // Behind a reverse proxy, trust its X-Forwarded-For so rate limits and
  // session records see the real client IP. Set TRUST_PROXY to the hop count.
  if (process.env.TRUST_PROXY) express.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  app.setGlobalPrefix('api/v1');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  const configured = allowedOrigins();
  const registry = app.get(TenantRegistry);
  app.enableCors({
    // WEB_ORIGIN, plus any web address registered to a tenant.
    origin: configured === true ? true : (origin, cb) => {
      if (!origin) return cb(null, false);
      const host = hostOf(origin);
      cb(null, configured.includes(origin) || (!!host && registry.knownHosts().has(host.toLowerCase())));
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
    maxAge: 600,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // JSON lines in production for log shippers; readable text in development.
    logger: new ConsoleLogger({ json: process.env.NODE_ENV === 'production', prefix: 'erp-api' }),
  });
  configureApp(app);
  if (mountOpenApi(app)) new Logger('Bootstrap').log('API reference at /api/docs');
  // Run Prisma's onModuleDestroy on SIGTERM so the pool drains on `docker stop`.
  app.enableShutdownHooks();
  const port = Number(process.env.PORT || 4000);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`Maintenance ERP API ready on http://localhost:${port}/api/v1`);
}

if (require.main === module) void bootstrap();
