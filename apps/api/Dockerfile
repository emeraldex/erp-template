# ─── Maintenance ERP API (NestJS + Prisma) ─────────────────────────────────────────
# Prisma 7 talks to Postgres through the pg driver adapter, so there is no
# native query-engine binary to match against musl — alpine needs no extras.

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# ─── dependencies (cached until a manifest or the lockfile changes) ──────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter api...

# ─── build ───────────────────────────────────────────────────────────────────
FROM deps AS build
COPY apps/api apps/api
# `deploy` emits a self-contained bundle at /prod/api — dist, prisma schema and
# migrations, prisma.config.ts, the entrypoint, and production-only node_modules
# (including the prisma CLI, which the entrypoint needs for `migrate deploy`).
RUN pnpm --filter api exec prisma generate \
 && pnpm --filter api exec nest build \
 && pnpm --filter=api deploy --prod --no-optional --legacy /prod/api

# ─── runtime ─────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /prod/api ./
RUN chmod +x ./docker-entrypoint.sh

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
