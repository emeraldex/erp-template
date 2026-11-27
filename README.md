# Maintenance ERP — Integrated Maintenance, Procurement & Job-Tracking System

A maintenance ERP for **any maintenance organisation, in any sector**: work orders,
assets and meters, preventive maintenance, parts and purchasing, vendor repairs,
invoicing, safety incidents and supplier registers — multi-client, bilingual (EN/BM),
with each client's statuses, steps, roles, permissions, terminology and modules held
as data they can change themselves.

Clients start from a **sector pack** — General maintenance, Facilities & buildings,
Fleet & vehicles, Industrial plant, Medical equipment, or Aviation MRO — see
[Setting up for any sector](docs/guides/sectors.md).

The **Aviation MRO** pack is the reference configuration and the default: it implements
**CO-RFP-IT-001** (Business Workflow & System Requirements Specification) for an approved
maintenance organisation servicing military and non-airborne electronic components.
Its modules, statuses, form references, roles and timers below are traceable to the RFP:
Section 4 (actors), Section 5 (workflows), Section 6 (forms register), Section 7
(functional requirements FR-01…FR-15) and Section 8 (mandatory demonstration scenario).

## Documentation

| For | Read |
|---|---|
| Installing and running client organisations | [Administrator guide](docs/guides/admin-guide.md) |
| Setting a client up for its sector (packs, terms, statuses, actions, permissions, assets, PM, stock, request portal, currency, look, labour) | [Setting up for any sector](docs/guides/sectors.md) |
| Daily use, by role | [User guide](docs/guides/user-guide.md) · [Panduan pengguna](docs/guides/panduan-pengguna.md) |
| How stock control works (ledger, costing, counts, purchasing) | [Stock](docs/architecture/stock.md) |
| How the public request portal works (tracking links, triage, protections) | [Request portal](docs/architecture/request-portal.md) |
| Currency, branding, labour and job cost, downtime and reliability, the accounting export | [Costs and reliability](docs/architecture/costs-and-reliability.md) |
| Quotations, purchases and invoices in other currencies; exchange rates; gain or loss | [Multi-currency](docs/architecture/multi-currency.md) |
| Integrations | [API guide](docs/api/README.md) and the generated reference at `/api/docs` |
| Security reviews | [Security overview](docs/security-overview.md) |
| Sales demos | [Running a demo](docs/demo-environment.md) |
| Backups | [Backup and restore](docs/operations/backup-and-restore.md) |

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

The seed is idempotent — it no-ops once users exist, so it is safe to re-run. It loads the
Aviation MRO pack; set `SEED_PACK` (`general`, `facilities`, `fleet`, `industrial` or
`medical`) to start from another sector. Those packs' demo users are `admin@`, `helpdesk@`,
`supervisor@`, `technician@`, `stores@`, `purchasing@`, `finance@` and `manager@company.example`.

With the aviation pack, sign in with any Section 4 actor — password `demo123`, or whatever
`SEED_PASSWORD` was set to when the database was first seeded (see *Before going live*):

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
pnpm --filter web test        # the phone app's offline sync rules
```

`node scripts/phone-offline-check.js` drives the phone app in an emulated phone
against a running facilities demo (`SEED_PACK=facilities`): it goes offline,
works a job, reconnects and checks the server received everything once.
`node scripts/stock-check.js` does the same for stock against a fresh fleet demo
(`SEED_PACK=fleet`): catalogue, receipts, reorder, a count, import, labels,
purchasing for stock, parts on a work order and on the phone.
`node scripts/portal-check.js` runs the request portal end to end against a fresh
facilities demo: a poster scan on a phone, triage on the desktop, messages,
completion and a rating.
`node scripts/polish-check.js` checks this release's features against a fresh
facilities demo:
- a logo, brand colour and the light theme;
- labour rates;
- a breakdown with the asset out of action;
- time logged offline on a phone;
- job cost and asset reliability;
- an invoice PDF with the logo;
- an accounting batch.

`node scripts/fx-check.js` checks transaction currencies against a fresh
facilities demo:
- exchange rates (a wrong-way rate is questioned);
- quotations in US and Singapore dollars;
- a receipt at the day's rate;
- a US-dollar invoice and its PDF;
- a payment with an exchange loss;
- the accounting batch.

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
- **FR-02 (configurability)** — statuses (with their meaning, or *phase*), transitions, role
  gates, mandatory fields, step actions, permissions, lists, terminology, modules and SLA
  timers are **data, not code**, per organisation, seeded from a sector pack
  (`apps/api/src/packs/`) and served at `GET /config`. The web client renders its menus,
  status pills, progress rails, action buttons and forms from this config; the workflow
  editor and settings change it at runtime with no redeploy.
- **FR-03** — every transition is gated to its QP "process owner" role; wrong role → 403
  with the owning roles named. Everything else is gated by permissions each organisation
  assigns to its roles (`@Requires('invoices.create')`…).
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
  command dashboard, each breach citing its QP source clause. A scheduler sends alerts
  shortly before (`SLA_WARN_DAYS`) and at each breach to the roles that own the next step
  (breaches also to MM), in the app's alerts bell and, with SMTP configured, by email digest.
  Each alert goes out once, even with several API replicas.
- **FR-11** — FOD incident reporting to the Focal Point, tool/TPME shadow-board
  accountability (IN/OUT/Tool-Missing-Report), and training records with recurrent due dates.
- **FR-12** — closed jobs lock editing; after `ARCHIVE_AFTER_DAYS` they are archived out of
  the active lists but stay readable with their full audit trail. The retention report shows
  each record's retain-until date (`RETENTION_YEARS`, 5) and flags what is past it for a
  human decision — nothing is deleted automatically. The audit trail exports to Excel/CSV.
- **FR-13** — four invoicing streams with tax from settings (GST 6% by default, any label and
  rate), certification + Certified True Copy, the correctness gate, and generated PDFs: tax
  invoice (amount in words), covering letter listing the stream's document set, delivery note,
  and a full pack with a checklist; CTC-stamped copies on request.
- **FR-14** — Sales Performance Report (Excel/CSV, per-stream summary), the e-Payment file for
  the ACD stream, outstanding payments by age, and payment recording.
- **FR-15** — AOG / ROA / Critical priority overlay with expedite routes and closure.
- **Attachments** — signed forms, certificates and photos on any record, with a SHA-256 checked
  on every download; stored on a volume or any S3-compatible bucket; never deletable.
- **§7.2 bilingual** — EN/BM toggle; status names and workflow action labels are bilingual
  in the config itself.
- **Beyond the RFP** — asset register with hierarchy and meters, preventive maintenance by
  calendar and/or meter with automatic work orders, job checklists that gate completion,
  and five more sector packs ([guide](docs/guides/sectors.md)).
- **Phone app** — an installable phone app (`/m`) for technicians: My work, assignment to
  named people, checklists, photos, notes and meter readings that work without a signal,
  photo and signature proof on workflow steps, and QR labels for assets
  ([how it works](docs/architecture/mobile-offline.md)).
- **Stock control** — parts catalogue, stores and bins, an append-only ledger with
  moving-average cost, issue/return to work orders with the parts cost, low-stock alerts
  and a reorder list that raises purchase requests, receipts into stock, counts that keep
  issues made while counting, spreadsheet import, QR shelf and bin labels, stock valuation
  and parts usage reports, and parts on the phone ([how it works](docs/architecture/stock.md)).
- **Request portal** — anyone the team serves can report a problem without an account, from
  a link or a "Report a problem" QR poster or sticker, with photos; the help desk accepts it
  into a work order, adds it to existing work or declines it; private tracking links,
  two-way messages, emails, a 1–5 rating when done, satisfaction on the dashboard and in a
  report ([how it works](docs/architecture/request-portal.md)).
- **Commercial polish** — each organisation's own currency (28, with amounts in words), its
  logo and brand colour on screens and PDFs, a light theme, plain documents outside aviation;
  labour time (desktop and offline phone) costed at person/role rates and a cost per work
  order; downtime from "out of action" breakdowns with availability, MTTR, MTBF and
  preventive compliance per asset and in a report; asset import from CSV; and once-only
  accounting export batches in Excel or CSV with the client's account codes
  ([how it works](docs/architecture/costs-and-reliability.md)).
- **Multi-currency** — quotations, purchases, vendor repairs and invoices in other currencies at
  dated exchange rates kept by finance, while the books stay in the organisation's currency:
  costs fixed at receipt, invoices fixed when the tax invoice is raised and shown in both
  currencies, the exchange gain or loss on payment, and the currencies in reports and the
  accounting export ([how it works](docs/architecture/multi-currency.md)).

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
GET   /config                          workflow-as-data (FR-02): statuses, steps, lists, terms, modules, permissions
PATCH /config/sla/:id                  runtime rule change (workflow.edit)
GET   /dashboard/kpis
GET|POST /jobs · GET /jobs/:id · PATCH /jobs/:id/transition · PATCH /jobs/:id/checklist
GET   /jobs/mine · GET /jobs/:id/pack · POST /jobs/:id/{notes,claim} · PATCH /jobs/:id/assignee
                                       phone app / field work (X-Client-Op makes resends safe)
GET   /users/directory · GET /assets/labels?ids=…
GET|POST /stock/parts · GET|PATCH /stock/parts/:id · PUT /stock/parts/:id/levels/:store
POST  /stock/{issue,return,receive,adjust,transfer} · GET /stock/movements · GET /jobs/:id/parts
GET|POST /stock/reorder · /stock/counts[/:id[/post|/cancel]] · POST /stock/import?dryRun=1
GET   /stock/labels?ids=…&store=… · GET /reports/{stock-valuation,parts-usage}
GET   /public/portal · POST /public/requests · POST /public/track[/messages|/rating|/cancel]
                                       request portal: no session; 404 while the module is off
GET|POST /requests · GET /requests/:id · POST /requests/:id/{accept,merge,decline,messages,erase}
GET|POST /requests/points · GET /requests/points/posters · GET /jobs/:id/requests · GET /reports/requests
POST  /jobs/:id/priority · PATCH /jobs/:id/priority · POST /jobs/:id/priority/close
                                       AOG/ROA/Critical overlay (QP.56)
GET   /demands · /demands/:id · POST /demands/:id/quotations · PATCH /demands/:id/transition
GET   /ov · /ov/:id · PATCH /ov/:id/transition
GET|POST /registers/partners · POST /registers/partners/:id/{evaluate,jtp-approve,register,reassess,car}
GET   /fod/{incidents,tools,training} · POST /fod/incidents · PATCH /fod/incidents/:id · /fod/tools/:tag
GET   /invoicing · /invoicing/streams · /invoicing/:id
POST  /invoicing · PATCH /invoicing/:id/transition
                                       invoice + DN lifecycle (QP.51)
GET   /invoicing/:id/documents/{tax-invoice|covering-letter|delivery-note|pack}[?ctc=1]
                                       PDFs (FR-13)
GET   /reports/{sales-performance|e-payment|outstanding|audit}?from&to&format=xlsx|csv
GET   /retention/report · POST /retention/archive (ADMIN)
GET|POST /attachments/:entity/:id · GET /attachments/file/:id[/verify]
GET   /notifications · POST /notifications/:id/read · /notifications/read-all · POST /alerts/run (ADMIN)
GET   /settings · PATCH /settings/{company,tax,terms,modules,defaults,currency,brand,maintenance} (org.admin)
GET   /settings/currencies · PUT|DELETE /settings/logo · GET /tenant/logo (no sign-in)
GET|POST /jobs/:id/time · PATCH|DELETE /time/:id · GET /jobs/:id/cost
GET|PUT /labour/rates · PUT /labour/people/:id/rate · GET /reports/{labour,reliability}
GET   /assets/:id/reliability · POST /assets/import?dryRun=1
GET|PUT /accounting/settings · GET /accounting/preview · GET|POST /accounting/exports
GET   /accounting/exports/:id/file[?format=csv&sheet=sales|receipts|purchases]
GET|PUT /fx/rates · DELETE /fx/rates/:id · PATCH /registers/partners/:id/currency
                                       exchange rates (fx.manage to change)
GET|POST /assets · GET|PATCH /assets/:id · POST /assets/:id/meters
GET|POST /assets/:id/meters/:key/readings
GET   /pm/schedules[?due=1] · /pm/schedules/:id · /pm/forecast · POST /pm/schedules · PATCH /pm/schedules/:id
POST  /pm/schedules/:id/skip · POST /pm/run
GET   /tenant                          which organisation this address belongs to (no sign-in)
GET   /auth/sso · /auth/sso/start · /auth/sso/callback · GET|PUT /auth/sso/settings (ADMIN)
GET|POST /users · PATCH /users/:id · POST /users/:id/{reset-password,unlock,deactivate,reactivate} (ADMIN)
GET   /workflow · /workflow/history · PUT /workflow/{transitions/:kind,sla,streams/:id,dictionary/:kind} (workflow.edit)
PUT   /workflow/roles                  roles and their permissions (org.admin)
GET   /job-cards?ids=…                 printable A6 job cards with QR codes

The generated OpenAPI reference is served at /api/docs (API_DOCS).
```

## Design system

Radar-console identity in Company navy/red, dark by default with a light theme. All tokens
live in `apps/web/app/globals.css` (both themes meet WCAG AA contrast); each organisation can
set its own logo and accent colour in *Settings*, without a rebuild.
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

### Client organisations (multi-tenancy)

One installation can serve several client organisations, each in its own
PostgreSQL schema, found by the address used to reach it. Create them with
`node dist/tenants-cli.js create <id> --name … --host … [--pack fleet] --admin-email …`; see the
[administrator guide](docs/guides/admin-guide.md). A single-client install
needs none of this: everything lives in the default organisation
(`DATABASE_URL`'s schema). For several organisations, serve each address
through the reverse proxy (`--profile proxy`, `deploy/Caddyfile.example`) and
build the web app with `NEXT_PUBLIC_API_URL=/api/v1`.

Each organisation has its own users (Users screen), settings, single sign-on,
sector pack, vocabulary, permissions, workflow rules (Workflow editor), assets and
alert schedule.

### Security

- **Single sign-on.** Any OpenID Connect provider (Microsoft Entra ID, Google,
  Okta, Keycloak), set up per organisation in Settings. Users are matched by
  email; SSO can be required, with administrators keeping a password as a
  break-glass.
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
