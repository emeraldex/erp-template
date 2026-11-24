import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 moved the connection URL out of schema.prisma. Migrate/CLI read it
// from here; the runtime client gets it via the pg driver adapter in
// src/common/prisma.service.ts.
//
// Read through process.env rather than prisma's env() helper: env() resolves
// eagerly and throws when unset, which breaks `prisma generate` during an image
// build, where no database exists yet. Commands that actually need a connection
// (migrate deploy, db push) still fail loudly on the empty string.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node dist/seed-db.js',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
