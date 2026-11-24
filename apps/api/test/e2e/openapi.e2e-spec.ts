import { INestApplication } from '@nestjs/common';
import { buildOpenApi } from '../../src/openapi';
import { createApp } from './app';

describe('OpenAPI reference', () => {
  let app: INestApplication;
  beforeAll(async () => ({ app } = await createApp()));
  afterAll(() => app.close());

  it('lists every area of the API, tagged, with public routes marked', () => {
    const doc = buildOpenApi(app);
    const paths = Object.keys(doc.paths);
    for (const p of [
      '/api/v1/jobs', '/api/v1/jobs/{id}/transition', '/api/v1/invoicing/{id}/documents/{kind}', '/api/v1/reports/sales-performance',
      '/api/v1/attachments/{entity}/{entityId}', '/api/v1/workflow/transitions/{kind}', '/api/v1/users', '/api/v1/auth/sso/start', '/api/v1/job-cards',
    ]) expect(paths).toContain(p);
    expect(doc.paths['/api/v1/jobs'].get!.tags).toEqual(['jobs']);
    expect(doc.paths['/api/v1/health'].get!.security).toEqual([]);
    expect(doc.paths['/api/v1/users'].get!.security).toEqual([{ cookie: [] }, { bearer: [] }]);
    expect(paths.length).toBeGreaterThan(60);
  });
});
