# Integrating with the Maintenance ERP API

The full, always-current reference is generated from the code and served at
**`/api/docs`** (raw JSON at `/api/docs-json`). It is on in development and
off in production unless you set `API_DOCS=true`. This page explains the parts
the reference cannot: how to authenticate, which organisation you are talking
to, and a few worked examples.

## Base URL and organisation

Every route is under `/api/v1`. The organisation (tenant) is chosen by the
**address you call** — `https://acme.erp.example.com/api/v1/...` reaches Acme's
data and nothing else. A single-organisation install answers on any address.

## Authenticating a script

Sign in once and keep the token for the session (8 hours by default, ended
early by 60 minutes of inactivity):

```bash
curl -s https://acme.erp.example.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"integration@acme.example","password":"…","tokenInBody":true}'
```

The response contains `token`. Send it on every call:

```bash
curl -s https://acme.erp.example.com/api/v1/jobs -H "Authorization: Bearer $TOKEN"
```

Create a dedicated user for each integration (Users screen), with the least
powerful role that can do the job. Its actions appear under that name in every
audit trail. A token is only valid at the organisation that issued it.

Browsers use the `erp_session` cookie instead and must send
`X-Requested-With` on every change; bearer-token callers do not need it.

## Worked examples

Every organisation keeps its own statuses, lists and fields, so read
`GET /config` first: it lists the statuses of each workflow (with their
*phase*), every step and the fields it needs, and the organisation's lists
(`dictionary.site`, `dictionary.category`, `dictionary.assetType`…).

Register a job (needs the `jobs.register` permission — STORES in the aviation pack):

```bash
curl -s https://acme.erp.example.com/api/v1/jobs -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"component":"IFF Transponder LRU","partNo":"AN/APX-113","serialNo":"SN-88231","category":"MILITARY","originUnit":"CPU Central","repairUnit":"CENTRAL"}'
```

Move it to the next stage — the body names the target status and the fields
that step requires (`GET /config` lists every step and its fields):

```bash
curl -s -X PATCH https://acme.erp.example.com/api/v1/jobs/PS-2026-0414/transition \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"to":"AWAITING_TDI","fields":{"f219Ref":"F219-2026-0414"}}'
```

In other sectors the same calls apply with that organisation's keys — for
example a work order raised against an asset, which fills in what and where:

```bash
curl -s https://fleet.erp.example.com/api/v1/jobs -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"assetId":"AST-2026-0003","category":"SERVICE","originUnit":"Deliveries"}'
```

Record a meter reading (meter-based maintenance that falls due is raised at once; the
response lists the work orders raised):

```bash
curl -s https://fleet.erp.example.com/api/v1/assets/AST-2026-0003/meters/ODOMETER/readings \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"value":58210}'
```

Attach a signed form:

```bash
curl -s https://acme.erp.example.com/api/v1/attachments/job/PS-2026-0414 \
  -H "Authorization: Bearer $TOKEN" -F 'file=@F219-signed.pdf;type=application/pdf' -F formNo=F219
```

Download this month's Sales Performance Report as CSV:

```bash
curl -s -o spr.csv "https://acme.erp.example.com/api/v1/reports/sales-performance?format=csv" -H "Authorization: Bearer $TOKEN"
```

### Field work (the phone app)

- `GET /jobs/mine` — `{ mine, available }`: work assigned to you, and
  unassigned work at your site that your role can take.
- `GET /jobs/:id/pack` — one job with its asset, meters, attachments,
  preventive-maintenance instructions and the steps you may take.
- `POST /jobs/:id/notes` `{ "text": "…" }`, `POST /jobs/:id/claim`,
  `PATCH /jobs/:id/assignee` `{ "userId": "…" | null }` (needs `jobs.assign`).
- `GET /users/directory` — active staff (id, name, role, site) for pickers.
- `GET /assets/labels?ids=…` — A4 PDF of QR labels.
- Photos and signatures: upload with `kind=photo` (and `caption`) or
  `kind=signature` (a PNG with `signedBy`); a step's photo or signature field
  takes the attachment id.

**Sending changes made offline.** Send `X-Client-Op: <your id for the change>`
with a note, attachment upload or meter reading. A resend with the same id
answers `200 {"duplicate": true}` without applying it again; a refused change
does not use up its id. Checklist changes and meter readings accept `"at"`, the
time the change was made (not in the future, at most 30 days ago).

### Parts and stock

All under `/stock`, when the organisation has the stock module on.

- `GET /stock/parts?q=&group=&store=&low=1`, `GET /stock/parts/:id` (with its
  ledger and open purchase requests), `POST /stock/parts`, `PATCH
  /stock/parts/:id`, `PUT /stock/parts/:id/levels/:store` `{ bin, reorderPoint,
  reorderQty }`.
- `POST /stock/issue` and `POST /stock/return` `{ partId, store, qty, jobId }`
  (`stock.issue`; accept `X-Client-Op`). `GET /jobs/:id/parts` — the parts on a
  work order and their cost.
- `POST /stock/receive` `{ partId, store, qty, unitCost, reason }`, `POST
  /stock/adjust` `{ partId, store, qty (±), reason }`, `POST /stock/transfer`
  `{ partId, from, to, qty }`, `GET /stock/movements?partId=&store=&jobId=&from=&to=`.
- `GET /stock/reorder`; `POST /stock/reorder` `{ items: [{ partId, store, qty }] }`
  → `{ raised: ["DM-…"] }`.
- Counts: `POST /stock/counts` `{ store, group?, note? }`, `PATCH
  /stock/counts/:id` `{ lines: [{ partId, countedQty }] }`, `POST
  /stock/counts/:id/post`, `POST /stock/counts/:id/cancel`, `GET /stock/counts`.
- `POST /stock/import?dryRun=1` — multipart field `file`, a CSV; answers
  `{ rows, created, updated, levels, openings, errors: [{ row, message }] }`.
  Without `dryRun` it imports, or answers 400 with the same `errors` and
  changes nothing.
- `GET /stock/labels?ids=…&store=…` — A4 PDF of QR labels.
- Reports: `GET /reports/stock-valuation`, `GET /reports/parts-usage?from&to`
  (`format=xlsx|csv`).

```bash
curl -s -X POST "https://acme.erp.example.com/api/v1/stock/import?dryRun=1" \
  -H "Authorization: Bearer $TOKEN" -F "file=@parts.csv"
```

## Errors

Errors are JSON: `{"statusCode": 400, "message": "…"}`. The ones to handle:

| Status | Meaning |
|---|---|
| 400 | The request breaks a rule; `message` says which (e.g. a missing mandatory field) |
| 401 | Not signed in, session ended, or the token belongs to another organisation |
| 403 | Your role does not own this step or lacks the permission; `code: "MODULE_OFF"` when the organisation switched that module off; or `"PASSWORD_CHANGE_REQUIRED"` / `"SSO_REQUIRED"` |
| 404 | No such record in this organisation |
| 409 | Someone changed the record first — reload and retry |
| 429 | Too many requests from your address — back off and retry |

## Limits

- 600 requests per minute per IP address (`API_RATE_LIMIT`), 10 sign-ins per minute (`LOGIN_RATE_LIMIT`).
- Attachments up to 20 MB (`ATTACHMENT_MAX_MB`); PDF, images, XLSX, DOCX, CSV and TXT.
- Report periods up to three years; the audit export up to 50,000 rows.
