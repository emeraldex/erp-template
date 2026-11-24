import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { PrismaService } from '../../src/common/prisma.service';

export const PASSWORD = 'demo123';

export async function createApp(): Promise<{ app: INestApplication; prisma: PrismaService }> {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

/** Sign in and return the session cookie header value. */
export async function login(app: INestApplication, user: string, password = PASSWORD): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: `${user}@company.example`, password })
    .expect(200);
  const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('erp_session='));
  if (!cookie) throw new Error('no session cookie');
  return cookie.split(';')[0];
}

export async function bearer(app: INestApplication, user: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: `${user}@company.example`, password: PASSWORD, tokenInBody: true })
    .expect(200);
  return `Bearer ${res.body.token}`;
}
