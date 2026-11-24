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
  // Drop every tenant schema and the tenant registry too, so each run starts clean.
  const { rows } = await client.query(
    "SELECT nspname FROM pg_namespace WHERE nspname LIKE 't\\_%' OR nspname = 'erp_control'",
  );
  for (const r of rows) await client.query(`DROP SCHEMA "${r.nspname}" CASCADE`);
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await client.end();

  const opts = { cwd: `${__dirname}/../..`, env: process.env, stdio: 'pipe' as const };
  execSync('npx prisma migrate deploy', opts);
  execSync('npx ts-node --transpile-only src/seed-db.ts', opts);
  // Two client organisations, created the way an operator would.
  execSync('npx ts-node --transpile-only src/tenants-cli.ts create acme --name "Acme Aero" --host acme.test --host acme.test:3000 --demo', opts);
  execSync('npx ts-node --transpile-only src/tenants-cli.ts create beta --name "Beta Engineering" --host beta.test --admin-email ops@beta.test', opts);
}
