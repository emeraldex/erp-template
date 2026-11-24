# Maintenance ERP — Integrated Maintenance, Procurement & Job-Tracking System

Prototype implementation of **CO-RFP-IT-001** (Business Workflow & System Requirements
Specification) for Company Name Sdn. Bhd. — an approved maintenance organisation (AMO)
servicing military and non-airborne electronic components for the Customer.

Every module, status, form reference, role and timer below is traceable to the RFP:
Section 4 (actors), Section 5 (workflows), Section 6 (forms register), Section 7
(functional requirements FR-01…FR-12) and Section 8 (mandatory demonstration scenario).

## Monorepo layout

```
erp-system/
├── apps/
│   ├── web/        Next.js 16 · React 19 · Tailwind 4 — bilingual (EN/BM) front-end
│   └── api/        NestJS 11 — config-driven workflow engine, RBAC, audit, SLA timers
├── docker-compose.yml       PostgreSQL 16 alone, for local development
├── docker-compose.prod.yml  full stack: db + api + web
└── turbo.json
```

## Quick start

The API is backed by PostgreSQL — it will not start without `DATABASE_URL`.

```bash
cp .env.example .env          # then set AUTH_SECRET to a real value:
                              #   openssl rand -hex 32
docker compose up -d db       # PostgreSQL 16 on :5432
pnpm install
pnpm --filter api exec prisma migrate deploy
pnpm --filter api exec prisma generate
pnpm --filter api build && node apps/api/dist/seed-db.js   # reference dataset
pnpm dev                      # web on :3000, api on :4000
```

The seed is idempotent — it no-ops once users exist, so it is safe to re-run.

Sign in with any Section 4 actor — password `demo123`, or whatever `SEED_PASSWORD`
was set to when the database was first seeded (see *Before going live*):

| Email | Role | Spec actor | Owns |
|---|---|---|---|
| aisyah@company.example | ADMIN | IT Mgmt | everything |
| rahim@company.example | STORES | StS/StP | job registration, dispatch, stock checks, receipts, DN |
| meiling@company.example | WORKSHOP | Tst/ATP | TDI, spares demand, routing decisions |
| daniel@company.example | MIS | MIS | WIP start, final inspection & certification |
| hafiz@company.example | MM | SMM/HOD | demand approval, indents, BER, closure |
| suresh@company.example | PURCHASING | PcE | RFQ, quotations, evaluation, PO |
| kumar@company.example | PCE | PCE | outside-vendor repair pipeline |
| qistina@company.example | QUALITY | QAD/JTP | JTP approval, CARs, SLA rule changes |
| farah@company.example | FINANCE | Finance | payment steps |
| zara@company.example | BILLING | Billing | invoice (F311) + delivery note (F218) |

**Demo mode.** Build the web app with `NEXT_PUBLIC_DEMO_MODE=1` and it can be shown
without the API: screens fall back to bundled sample data with a `DEMO DATA` notice,
and write actions are disabled. Without that flag (the default), an unreachable API
shows a "cannot reach the server" banner instead of sample records.

## Testing

```bash
pnpm --filter api test        # unit tests: workflow engine and business rules
pnpm --filter api test:cov    # the same, with a coverage report
```

The integration tests boot the real API against PostgreSQL. Point
`TEST_DATABASE_URL` at a **disposable** database whose name contains `test` — its
schema is dropped and recreated on every run:

```bash
createdb erp_test
TEST_DATABASE_URL=postgresql://erp:erp@localhost:5432/erp_test pnpm --filter api test:e2e
```

`scripts/section8-demo.py` runs the RFP's Section 8 scenario end to end against a
running API. GitHub Actions runs all of these, plus type checks, the web build and a
dependency audit, on every push and pull request.

## How the requirements are met

- **FR-01** — every job is a single PS-numbered record tracked receipt-to-return (`/jobs`).
- **FR-02 (configurability)** — statuses, transitions, role gates, mandatory fields and SLA
  timers are **data, not code** (`apps/api/src/common/workflow-config.ts`), served at
  `GET /config`. The web client renders its status pills, action buttons and forms from
  this config; `PATCH /config/sla/:id` changes a timer at runtime with no redeploy.
- **FR-03** — every transition is gated to its QP "process owner" role; wrong role → 403
  with the owning roles named.
- **FR-04** — every change appends a timestamped audit entry (who/role/action/field values);
  status + location history is visible on each record.
- **FR-05** — mandatory fields per transition (e.g. certification identity, capacity/stamp on
  `WIP → SERVICEABLE`) are enforced server-side and rendered as required inputs client-side.
  Form-numbered fields are auto-filed into the entity's Section 6 records register.
- **FR-06** — electronic sign-off gates: HOD demand approval, JTP partner approval,
  customer indent, and the QP.33 dual customer approvals (F134 + price quotation).
- **FR-07** — supplier/sub-contractor registers (F224 / AVL / MSN / F229) with ratings
  (Good 3 / Suitable 2 / Not Suitable 1), the performance formula
  *(non-conformances ÷ factors evaluated) × 100%*, CAR (F516) tracking with
  drop-on-second-CAR for Not-Suitable partners, and 3-year reassessment due dates.
- **FR-08** — stock check (F244) → NIL-stock branch → RFQ (F220) → quotation comparison with
  the **minimum-three rule enforced** (or local purchase F241) → evaluation (F221) →
  PO (F312) → receiving inspection with optional discrepancy (F217).
- **FR-09** — QP.33 outside-vendor path with both customer-approval gates, cost & EDD
  capture, and above-indent quotation (F119) handling.
- **FR-10** — configurable SLA timers (2/5/14/15-day, 6-month) with a breach board on the
  command dashboard, each breach citing its QP source clause.
- **FR-11** — FOD incident reporting to the Focal Point, tool/TPME shadow-board
  accountability (IN/OUT/Tool-Missing-Report), and training records with recurrent due dates.
- **FR-12** — 5-year retention posture (closed jobs lock editing), status/ageing dashboards.
- **§7.2 bilingual** — EN/BM toggle; status names and workflow action labels are bilingual
  in the config itself.

## Section 8 demonstration script

`python3 scripts/section8-demo.py` (API running) walks the mandatory scenario end-to-end:
register → dispatch → TDI → spares procurement (stock check → RFQ → 3 quotes → PO) →
maintenance + certification → invoice + DN → close → audit trail, plus a CAR on a supplier
and a FOD incident — asserting the 403/400 guard rails along the way.

It defaults to `http://localhost:4000/api/v1` and the stock `demo123` password; point it
at another deployment with `ERP_API` and `ERP_PASSWORD`:

```bash
ERP_API=http://10.0.0.5:4000/api/v1 ERP_PASSWORD=… python3 scripts/section8-demo.py
```

Note that it **writes** — it creates real jobs, demands, POs and invoices. Run it against a
demo or staging database, not one holding live records.

## API surface (prefix `/api/v1`)

```
GET   /health                          liveness + database check (no sign-in)
POST  /auth/login                      sets the session cookie
POST  /auth/logout · GET /auth/me · POST /auth/change-password
GET   /config                          workflow-as-data (FR-02)
PATCH /config/sla/:id                  runtime rule change (ADMIN/QUALITY)
GET   /dashboard/kpis
GET|POST /jobs · GET /jobs/:id · PATCH /jobs/:id/transition
POST  /jobs/:id/priority · PATCH /jobs/:id/priority · POST /jobs/:id/priority/close
                                       AOG/ROA/Critical overlay (QP.56)
GET   /demands · /demands/:id · POST /demands/:id/quotations · PATCH /demands/:id/transition
GET   /ov · /ov/:id · PATCH /ov/:id/transition
GET|POST /registers/partners · POST /registers/partners/:id/{evaluate,jtp-approve,register,reassess,car}
GET   /fod/{incidents,tools,training} · POST /fod/incidents · PATCH /fod/incidents/:id · /fod/tools/:tag
GET   /invoicing · /invoicing/streams · /invoicing/:id
POST  /invoicing · PATCH /invoicing/:id/transition
                                       invoice + DN lifecycle (QP.51)
```

## Design system

Radar-console identity in Company navy/red. All brand tokens live in
`apps/web/app/globals.css` — a one-file swap when the official brand guide is applied.
Typography: Rajdhani (display) · IBM Plex Sans (body) · IBM Plex Mono (refs/telemetry).
Signature elements: the operations radar (each blip a live open job by branch bearing),
the QP.44 lifecycle rail, count-up KPIs, telemetry ticker, staggered reveals — all
disabled under `prefers-reduced-motion`.

## Production deployment

```bash
cp .env.prod.example .env.prod        # fill in every blank; see the file's header
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Four services: `db` (PostgreSQL 16), `api`, `web` and `backup`. The API container applies
migrations on start (`prisma migrate deploy`) and seeds the reference dataset
only if the database is empty. Postgres sits on an `internal` network — the web
container cannot reach it, and it is not published to the host. `api` and `web`
bind to loopback by default; terminate TLS in a reverse proxy in front of them.

Two things to get right before the first build:

- **`NEXT_PUBLIC_API_URL` is inlined into the browser bundle at build time**, not
  read at container start. It must be the URL *a browser* can reach — never the
  internal `api` service name, and not `localhost` if the app is served to other
  machines. Changing it means rebuilding the web image (`--build`), not just
  restarting it. Verify what actually landed:
  `docker exec <web-container> grep -rhoE "http://[^\"]+/api/v1" apps/web/.next/static | sort -u`
- **`POSTGRES_PASSWORD` must be URL-safe** — it is interpolated into
  `DATABASE_URL`. Generate it with `openssl rand -hex 24`; see the note in
  `.env.prod.example`.

`API_BIND` / `WEB_BIND` accept any local address, not just `127.0.0.1` or
`0.0.0.0`. Binding a specific interface address — a VPN or tailnet address, say —
serves the stack on that interface *only*, which is a tighter default than
`0.0.0.0` when the host is also on an untrusted LAN.

### Persistence

`StoreService` is a PostgreSQL-backed aggregate store (`apps/api/src/common/`).
Services hydrate an aggregate, mutate it, and hand it to `save()`, which writes
the whole aggregate — plus any sibling aggregates the same workflow step touched
— in one transaction. Audit entries, Section 6 form records, quotations and CARs
are append-only child tables, so FR-04 and the FR-12 retention posture are
queryable rather than buried in JSON.

Concurrent edits are caught by an optimistic `version` column: a transition that
reads version *n* writes *n+1*, and a second writer racing the first gets `409`
rather than silently overwriting it.

Workflow rules (transitions, SLA timers, invoice streams) are rows too, so an
FR-02 runtime change such as `PATCH /config/sla/:id` now survives a restart.

### Security

- **Sessions.** Signing in creates a server-side session and sets it in an
  `httpOnly`, `SameSite=Strict` cookie (`Secure` in production), so page scripts
  never see the credential. Sessions end on sign-out, after `AUTH_IDLE_MINUTES`
  without activity, after `AUTH_TTL_HOURS` in total, and on every other device
  when the user changes their password. Scripts can use a bearer token instead
  (`POST /auth/login` with `"tokenInBody": true`).
- **CSRF.** Cookie-authenticated writes must send an `X-Requested-With` header,
  which a cross-site form or image cannot add.
- **Sign-in protection.** After `LOGIN_MAX_ATTEMPTS` failures an account locks for
  `LOGIN_LOCK_MINUTES`. Sign-in is rate-limited per IP (`LOGIN_RATE_LIMIT`), as is
  the API as a whole (`API_RATE_LIMIT`). Failed sign-ins give the same message
  whether or not the account exists.
- **Passwords.** scrypt-hashed. New passwords need at least 12 characters and are
  checked against the email name and common choices. With
  `SEED_FORCE_PASSWORD_CHANGE=1` (the production default) every seeded user must
  choose their own password at first sign-in.
- **HTTP.** `helmet` security headers; credentialed CORS only from `WEB_ORIGIN`,
  which the API requires in production.
- **Behind a proxy.** Set `TRUST_PROXY` to the number of proxy hops so rate limits
  and session records see real client IPs. Serve the web app and the API from the
  same site (for example `erp.example.com` and `api.erp.example.com`, or one host
  with the API under `/api`), or the `SameSite=Strict` cookie will not be sent.

### Operations

- **Health.** `GET /api/v1/health` returns `200` when the API can reach the
  database and `503` when it cannot. Docker's health checks use it; point uptime
  monitoring at it too.
- **Logs.** In production the API writes one JSON object per line, including one
  line per request (method, path, status, duration, user id). Request bodies,
  query strings and headers are never logged.
- **Backups.** The `backup` service takes a verified nightly dump. See
  [docs/operations/backup-and-restore.md](docs/operations/backup-and-restore.md)
  for checking, rehearsing and restoring, and copy the backup directory off the
  server.

### Before going live

- **Passwords.** The reference dataset ships `demo123` for all ten accounts. Keep
  `SEED_FORCE_PASSWORD_CHANGE=1` so each user replaces it at first sign-in, and set
  `SEED_PASSWORD` so the interim password is not public knowledge.
- **HTTPS.** Terminate TLS in a reverse proxy and keep `COOKIE_SECURE=true`.
- **Identity.** To move to a corporate identity provider, replace
  `AuthService.authenticate()` (`apps/api/src/auth/auth.service.ts`) with the
  provider's token validation; the guard and role gates above it are unchanged.
- **Backups.** Rehearse a restore once, and confirm dumps are copied off the server.

## License

Copyright 2026 emeraldex. Licensed under the
[PolyForm Strict License 1.0.0](LICENSE).

You may use this software for **non-commercial purposes only**, as defined in
the licence (for example personal study, or use by a charity, school or
government body). You may **not**
modify it, create works based on it, distribute it, or use it in the course
of running a business, except as allowed under *Evaluation permission* below.
Commercial use, deployment or customisation requires a
separate written licence. Contact the copyright holder via
[GitHub](https://github.com/emeraldex).

### Evaluation permission

In addition to the PolyForm Strict License, the licensor grants prospective
clients a limited, non-exclusive, non-transferable permission to install and
run the software for **up to 30 days** from first installation, solely to
evaluate whether to obtain a commercial licence.

During evaluation you may not use the software in production or with live
operational data, modify it, distribute it, or make it available to anyone
outside your organisation. Setting the configuration values needed to run it
(such as environment variables) does not count as modifying it. When the 30
days end, stop using the software and delete all copies unless you have
obtained a commercial licence. The licensor may withdraw this permission at
any time by written notice.

Third-party dependencies remain under their own licences.
