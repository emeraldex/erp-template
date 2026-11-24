#!/bin/sh
# Apply migrations, then optionally seed, before handing off to the API.
# `migrate deploy` only applies committed migrations — it never generates or
# resets, so it is safe to run on every container start, including replicas
# (Prisma takes an advisory lock, so concurrent starts serialise).
set -e

if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  # The default schema plus every registered client organisation's schema.
  echo "→ applying migrations"
  node dist/tenants-cli.js migrate-all
fi

if [ "${RUN_SEED:-0}" = "1" ]; then
  echo "→ seeding (skips automatically if data already present)"
  node dist/seed-db.js
fi

exec "$@"
