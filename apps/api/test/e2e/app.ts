import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { PrismaClient } from '../../src/generated/prisma/client';
import { Database } from '../../src/tenancy/database';

export const PASSWORD = 'demo123';

/** The app, plus a database client for the default tenant for arranging test data directly. */
export async function createApp(): Promise<{ app: INestApplication; prisma: PrismaClient }> {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  const db = app.get(Database);
  return { app, prisma: db.client(db.defaultSchema) };
}

/** Sign in and return the session cookie header value (optionally at another tenant's address). */
export async function login(app: INestApplication, user: string, password = PASSWORD, host?: string): Promise<string> {
  const req = request(app.getHttpServer()).post('/api/v1/auth/login');
  if (host) req.set('Host', host);
  const res = await req
    .send({ email: user.includes('@') ? user : `${user}@company.example`, password })
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
