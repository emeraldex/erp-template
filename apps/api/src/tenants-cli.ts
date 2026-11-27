/**
 * Manage client organisations (tenants). Each lives in its own PostgreSQL schema.
 *
 *   node dist/tenants-cli.js create <id> --name "Acme Aero" --host acme.erp.example.com \
 *        [--host …] [--pack general|aviation|facilities|fleet|industrial|medical]
 *        [--admin-email ops@acme.example --admin-name "Ops Lead"] [--currency SGD] [--demo]
 *   node dist/tenants-cli.js packs                  # the sector packs a client can start from
 *   node dist/tenants-cli.js list
 *   node dist/tenants-cli.js migrate-all            # default schema + every tenant
 *   node dist/tenants-cli.js set-hosts <id> <host> […]
 *   node dist/tenants-cli.js suspend <id> | activate <id>
 *   node dist/tenants-cli.js set-currency <id|default> <code> [--force]   # e.g. SGD; --force relabels recorded amounts
 *
 * There is deliberately no delete: removing a client's data is a decision for
 * a person, with a backup in hand (DROP SCHEMA t_<id> CASCADE).
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import { resolve } from 'path';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import { hashPassword } from './common/password';
import { parseDatabaseUrl } from './tenancy/database';
import { schemaFor, TENANT_ID } from './tenancy/tenant';
import { CONTROL_SCHEMA, ensureControlSchema } from './tenancy/tenant-registry';
import { seedReferenceData, seedWorkflow } from './seed-db';
import { DEFAULT_PACK, getPack, PACKS } from './packs';
import { seedPackDemo } from './packs/demo';
import { CURRENCIES } from './settings/currency';

const APP_ROOT = resolve(__dirname, '..');
const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/;

interface Args { positional: string[]; flags: Record<string, string[]> }

export function parseArgs(argv: string[]): Args {
  const out: Args = { positional: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      const value = next && !next.startsWith('--') ? (i++, next) : 'true';
      (out.flags[key] ??= []).push(value);
    } else out.positional.push(a);
  }
  return out;
}

function urlFor(schema: string): string {
  const u = new URL(parseDatabaseUrl().url);
  u.searchParams.set('schema', schema);
  return u.toString();
}

/** Apply committed migrations to one schema (idempotent). */
export function migrateSchema(schema: string): void {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: APP_ROOT, stdio: 'inherit', env: { ...process.env, DATABASE_URL: urlFor(schema) },
  });
}

function client(schema: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: parseDatabaseUrl().url }, { schema }) });
}

function normaliseHosts(hosts: string[]): string[] {
  const out = hosts.map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
  for (const h of out) if (!HOST.test(h)) throw new Error(`Not a valid host: "${h}"`);
  return [...new Set(out)];
}

async function create(pool: Pool, args: Args): Promise<void> {
  const [id] = args.positional;
  const name = args.flags.name?.[0];
  if (!id || !TENANT_ID.test(id) || id === 'default') {
    throw new Error('Tenant id must be 2–31 lower-case letters, digits or hyphens, start with a letter, and not be "default"');
  }
  if (!name) throw new Error('--name is required');
  const hosts = normaliseHosts(args.flags.host ?? []);
  if (!hosts.length) throw new Error('At least one --host is required (the address its users will open)');
  const pack = getPack(args.flags.pack?.[0] ?? DEFAULT_PACK);
  const schema = schemaFor(id);
  const currency = args.flags.currency?.[0]?.toUpperCase();
  if (currency && !CURRENCIES.some((c) => c.code === currency)) throw new Error(`Unknown currency ${currency} (one of ${CURRENCIES.map((c) => c.code).join(', ')})`);

  const { rows: clash } = await pool.query(
    `SELECT id FROM ${CONTROL_SCHEMA}.tenants WHERE id = $1 OR hosts && $2::text[]`, [id, hosts],
  );
  if (clash.length) throw new Error(`Tenant id or host already registered (to ${clash.map((r) => r.id).join(', ')})`);

  console.log(`→ creating schema ${schema} and applying migrations`);
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  migrateSchema(schema);

  const prisma = client(schema);
  try {
    if (await prisma.user.count()) throw new Error(`Schema ${schema} already has users — refusing to seed over it`);
    console.log(`→ setting up from the ${pack.name} pack`);
    await seedWorkflow(prisma, pack);
    if (args.flags.demo) {
      console.log('→ loading the demo dataset (password demo123 unless SEED_PASSWORD is set)');
      if (pack.id === 'aviation') await seedReferenceData(prisma);
      else await seedPackDemo(prisma, pack);
    } else {
      const email = args.flags['admin-email']?.[0]?.toLowerCase();
      if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('--admin-email is required (or pass --demo)');
      const password = randomBytes(12).toString('base64url');
      await prisma.user.create({
        data: {
          id: `u-${randomBytes(4).toString('hex')}`, name: args.flags['admin-name']?.[0] ?? 'Administrator', email,
          passwordHash: await hashPassword(password), role: 'ADMIN', designation: 'IT', branch: pack.dictionaries.site[0].key, mustChangePassword: true,
        },
      });
      console.log(`\n  First administrator: ${email}\n  Temporary password:  ${password}\n  (shown once; they must change it at first sign-in)\n`);
    }
    await prisma.setting.upsert({
      where: { key: 'company' }, create: { key: 'company', value: { name } as never, updatedBy: 'tenants-cli' }, update: {},
    });
    if (currency) await prisma.setting.upsert({ where: { key: 'currency' }, create: { key: 'currency', value: { code: currency } as never, updatedBy: 'tenants-cli' }, update: { value: { code: currency } as never } });
  } finally {
    await prisma.$disconnect();
  }

  await pool.query(`INSERT INTO ${CONTROL_SCHEMA}.tenants (id, name, schema_name, hosts) VALUES ($1, $2, $3, $4)`, [id, name, schema, hosts]);
  console.log(`✓ tenant ${id} (${name}) ready at ${hosts.join(', ')} — running API servers pick it up within 30 s`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const pool = new Pool({ connectionString: parseDatabaseUrl().url, max: 2 });
  try {
    await ensureControlSchema({ pool });
    switch (command) {
      case 'create':
        return await create(pool, args);
      case 'list': {
        const { rows } = await pool.query(`SELECT id, name, schema_name, hosts, status, created_at FROM ${CONTROL_SCHEMA}.tenants ORDER BY id`);
        console.log(`default  (schema ${parseDatabaseUrl().schema}) — used for any address not listed below`);
        for (const r of rows) console.log(`${r.id.padEnd(8)} ${r.status.padEnd(9)} ${r.schema_name.padEnd(16)} ${r.hosts.join(', ')}  — ${r.name}`);
        return;
      }
      case 'migrate-all': {
        const { rows } = await pool.query(`SELECT id, schema_name FROM ${CONTROL_SCHEMA}.tenants ORDER BY id`);
        const { schema } = parseDatabaseUrl();
        for (const [id, s] of [['default', schema], ...rows.map((r) => [r.id, r.schema_name])]) {
          console.log(`→ migrating ${id} (${s})`);
          await pool.query(`CREATE SCHEMA IF NOT EXISTS "${s}"`);
          migrateSchema(s);
        }
        return;
      }
      case 'packs': {
        for (const p of Object.values(PACKS)) console.log(`${p.id.padEnd(11)} ${p.name}\n            ${p.description}`);
        return;
      }
      case 'set-hosts': {
        const [id, ...hosts] = args.positional;
        const res = await pool.query(`UPDATE ${CONTROL_SCHEMA}.tenants SET hosts = $2 WHERE id = $1`, [id, normaliseHosts(hosts)]);
        if (!res.rowCount) throw new Error(`No tenant ${id}`);
        console.log(`✓ ${id} hosts updated`);
        return;
      }
      case 'suspend':
      case 'activate': {
        const [id] = args.positional;
        const res = await pool.query(`UPDATE ${CONTROL_SCHEMA}.tenants SET status = $2 WHERE id = $1`, [id, command === 'suspend' ? 'suspended' : 'active']);
        if (!res.rowCount) throw new Error(`No tenant ${id}`);
        console.log(`✓ ${id} ${command === 'suspend' ? 'suspended' : 'active'}`);
        return;
      }
      case 'set-currency': {
        const [id, raw] = args.positional;
        const code = raw?.toUpperCase();
        if (!id || !CURRENCIES.some((c) => c.code === code)) throw new Error(`Usage: set-currency <id|default> <code>; codes: ${CURRENCIES.map((c) => c.code).join(', ')}`);
        let schema = parseDatabaseUrl().schema;
        if (id !== 'default') {
          const { rows } = await pool.query(`SELECT schema_name FROM ${CONTROL_SCHEMA}.tenants WHERE id = $1`, [id]);
          if (!rows.length) throw new Error(`No tenant ${id}`);
          schema = rows[0].schema_name;
        }
        const prisma = client(schema);
        try {
          const recorded = (await prisma.invoice.count()) + (await prisma.quotation.count()) + (await prisma.stockMovement.count({ where: { unitCost: { gt: 0 } } }));
          if (recorded && !args.flags.force) {
            throw new Error(`${id} already has amounts recorded; they would be relabelled as ${code}, not converted. Re-run with --force if that is what you want.`);
          }
          // Foreign-currency records hold a rate against the old currency: relabelling would make them wrong.
          const foreign = (await prisma.quotation.count({ where: { currency: { not: null } } })) + (await prisma.invoice.count({ where: { currency: { not: null } } }))
            + (await prisma.ovRepair.count({ where: { currency: { not: null } } })) + (await prisma.demand.count({ where: { purchaseCurrency: { not: null } } }))
            + (await prisma.stockMovement.count({ where: { currency: { not: null } } }));
          if (foreign) throw new Error(`${id} has ${foreign} record(s) in a foreign currency with exchange rates against its current currency; its currency cannot be changed.`);
          // Rates were quoted against the old currency.
          const rates = await prisma.exchangeRate.deleteMany({});
          await prisma.setting.upsert({ where: { key: 'currency' }, create: { key: 'currency', value: { code } as never, updatedBy: 'tenants-cli' }, update: { value: { code } as never, updatedBy: 'tenants-cli' } });
          console.log(`✓ ${id} now keeps its books in ${code}${recorded ? ' (existing amounts relabelled, not converted)' : ''}${rates.count ? `; ${rates.count} exchange rate(s) removed` : ''} — running API servers pick it up within 30 s`);
        } finally {
          await prisma.$disconnect();
        }
        return;
      }
      default:
        console.log('Usage: tenants-cli create|list|packs|migrate-all|set-hosts|suspend|activate|set-currency (see the header of src/tenants-cli.ts)');
        process.exitCode = command ? 1 : 0;
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  });
}
