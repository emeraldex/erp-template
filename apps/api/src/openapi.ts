import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/** Routes callable without a session. */
const PUBLIC = ['/api/v1/health', '/api/v1/tenant', '/api/v1/auth/login', '/api/v1/auth/sso', '/api/v1/auth/sso/start', '/api/v1/auth/sso/callback'];

/** The OpenAPI document, generated from the running application's routes. */
export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Maintenance ERP API')
    .setDescription(
      'Every route is under /api/v1 and belongs to the organisation the request is addressed to (by host). ' +
      'Browsers authenticate with the httpOnly session cookie set by POST /auth/login and must send X-Requested-With on writes; ' +
      'scripts can POST /auth/login with "tokenInBody": true and send Authorization: Bearer <token>. ' +
      'See docs/api/README.md for worked examples.',
    )
    .setVersion('1.0')
    .addCookieAuth('erp_session')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  for (const [path, item] of Object.entries(doc.paths)) {
    const tag = path.replace(/^\/api\/v1\//, '').split('/')[0] || 'root';
    for (const op of Object.values(item) as { tags?: string[]; security?: object[] }[]) {
      if (typeof op !== 'object' || !op) continue;
      op.tags = [tag];
      op.security = PUBLIC.includes(path) ? [] : [{ cookie: [] }, { bearer: [] }];
    }
  }
  return doc;
}

/** Serve the reference at /api/docs (and /api/docs-json) when enabled. */
export function mountOpenApi(app: INestApplication): boolean {
  const flag = (process.env.API_DOCS ?? '').toLowerCase();
  const on = flag ? ['1', 'true', 'yes'].includes(flag) : process.env.NODE_ENV !== 'production';
  if (on) SwaggerModule.setup('api/docs', app, buildOpenApi(app), { jsonDocumentUrl: 'api/docs-json' });
  return on;
}
