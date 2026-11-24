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

Register a job (role STORES):

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

Attach a signed form:

```bash
curl -s https://acme.erp.example.com/api/v1/attachments/job/PS-2026-0414 \
  -H "Authorization: Bearer $TOKEN" -F 'file=@F219-signed.pdf;type=application/pdf' -F formNo=F219
```

Download this month's Sales Performance Report as CSV:

```bash
curl -s -o spr.csv "https://acme.erp.example.com/api/v1/reports/sales-performance?format=csv" -H "Authorization: Bearer $TOKEN"
```

## Errors

Errors are JSON: `{"statusCode": 400, "message": "…"}`. The ones to handle:

| Status | Meaning |
|---|---|
| 400 | The request breaks a rule; `message` says which (e.g. a missing mandatory field) |
| 401 | Not signed in, session ended, or the token belongs to another organisation |
| 403 | Your role does not own this step; or `code: "PASSWORD_CHANGE_REQUIRED"` / `"SSO_REQUIRED"` |
| 404 | No such record in this organisation |
| 409 | Someone changed the record first — reload and retry |
| 429 | Too many requests from your address — back off and retry |

## Limits

- 600 requests per minute per IP address (`API_RATE_LIMIT`), 10 sign-ins per minute (`LOGIN_RATE_LIMIT`).
- Attachments up to 20 MB (`ATTACHMENT_MAX_MB`); PDF, images, XLSX, DOCX, CSV and TXT.
- Report periods up to three years; the audit export up to 50,000 rows.
