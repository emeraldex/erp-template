import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  // Behind a reverse proxy the browser origin is fixed — set WEB_ORIGIN in
  // production rather than reflecting whatever Origin arrives.
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Run Prisma's onModuleDestroy on SIGTERM so the pool drains on `docker stop`.
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Maintenance ERP API ready on http://localhost:${port}/api/v1`);
}
bootstrap();
