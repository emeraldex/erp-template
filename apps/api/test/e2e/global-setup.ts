import { execSync } from 'child_process';
import { Client } from 'pg';
import './env';

/** Fresh schema → migrations → reference seed, once per test run. */
export default async function globalSetup(): Promise<void> {
  const url = process.env.DATABASE_URL!;
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error(`Refusing to reset "${url}": the integration-test database name must contain "test".`);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await client.end();

  const opts = { cwd: `${__dirname}/../..`, env: process.env, stdio: 'pipe' as const };
  execSync('npx prisma migrate deploy', opts);
  execSync('npx ts-node --transpile-only src/seed-db.ts', opts);
}
