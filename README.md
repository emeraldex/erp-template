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

The web app also runs without the API — screens fall back to bundled sample data with
an `OFFLINE SAMPLE` notice. Write actions require the live API.

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
POST  /auth/login
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

Three services: `db` (PostgreSQL 16), `api`, `web`. The API container applies
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

### Before going live

- **Passwords.** The reference dataset ships `demo123` for all ten accounts.
  They are scrypt-hashed at seed time (plaintext never reaches the database),
  but they are still public knowledge — set `SEED_PASSWORD`, or rotate every
  account immediately after first boot.
- **Identity.** Tokens are HMAC-signed (`auth.service.ts`). To move to a
  corporate IdP, replace `verify()` with the provider's token introspection;
  the guard and role gates above it are unchanged.
- **Backups.** Nothing here backs up the `pgdata` volume. Schedule `pg_dump`.
