# Administrator guide

For the person who installs the ERP and sets up each client organisation.
Day-to-day use is in the [user guide](user-guide.md).

## 1. Install

Follow *Production deployment* in the README: fill in `.env.prod`, then

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

The API applies database migrations for every organisation on start-up. Put a
TLS reverse proxy in front and serve the web app and the API from the **same
address** (the API under `/api`) — single sign-on and per-organisation
addresses rely on it.

## 2. Organisations (tenants)

One installation can serve several client organisations, each in its own
PostgreSQL schema: their data, users, settings and workflows never mix. A
single-client installation needs none of this — everything lives in the
default organisation.

Run these inside the API container (`docker compose exec api …`):

```bash
node dist/tenants-cli.js create acme --name "Acme Aero Services" --host acme.erp.example.com --admin-email it@acme.example --admin-name "Acme IT"
```

This creates the schema, applies migrations, loads a sector pack and prints a
**temporary password** for the first administrator — shown once. Add
`--pack general|facilities|fleet|industrial|medical` to start from another
sector than aviation (see [Setting up for any sector](sectors.md)). Add
`--demo` instead of `--admin-email` for a demonstration organisation with
sample data and a demo user per role (password `demo123`). Add
`--currency SGD` (or any code listed in *Settings → Currency and maintenance measures*) to keep the
organisation's books in another currency than Ringgit.

| Command | What it does |
|---|---|
| `list` | All organisations, their schema and addresses |
| `packs` | The sector packs an organisation can start from |
| `set-hosts acme acme.erp.example.com erp.acme.example` | Change an organisation's addresses |
| `suspend acme` / `activate acme` | Block / restore access (data kept) |
| `set-currency acme SGD [--force]` | Change the currency (`default` for the default organisation). Refused once money is recorded unless `--force`, which relabels amounts without converting them |
| `migrate-all` | Apply migrations everywhere (runs automatically on start) |

New organisations are picked up by running API servers within 30 seconds.
With `TENANT_STRICT_HOSTS=true`, addresses that belong to no organisation are
refused instead of reaching the default one — recommended for hosted
multi-client installations.

There is no delete command. To remove a client, take a backup, then drop its
schema (`DROP SCHEMA t_acme CASCADE`) and delete its row from
`erp_control.tenants`.

## 3. First sign-in for a new organisation

The first administrator signs in at the organisation's address with the
temporary password and must choose a new one. Then, in order:

1. **Settings → Company profile** — name, registration and tax numbers,
   address and signatory. These print on every invoice and letter.
2. **Settings → Tax** — the tax name and rate (the RFP specifies GST 6%;
   current Malaysian contracts typically use SST). Invoices keep the rate they
   were drafted with.
3. **Users** — add each member of staff with their role and branch. Each gets a
   temporary password to pass on securely; they must change it at first
   sign-in. Deactivate leavers rather than deleting them: their history stays.
4. **Settings → Your sector** — the words the screens use, the modules the
   client needs, and work-order numbering.
5. **Workflow editor** — adjust statuses and lists, who owns each step,
   mandatory fields, step actions, SLA timers and invoicing document sets to
   match the client's procedures; administrators also set what each role may
   do under *Roles & permissions*. Fields an action reads are marked NEEDED
   and must stay mandatory. Every change is logged with the full before and
   after.
6. **Assets and preventive maintenance** (if the modules are on) — load the
   asset register and its meters, then create schedules; work orders are
   raised automatically as they fall due.
7. **Single sign-on** (optional) — below.

## 4. Single sign-on

Settings → Single sign-on shows the **redirect URI** to register with the
client's identity provider. Users must already exist in the ERP; they are
matched by email address.

**Microsoft Entra ID**: Entra admin centre → App registrations → New
registration. Platform *Web*, redirect URI as shown. Under *Certificates &
secrets* create a client secret. The issuer is
`https://login.microsoftonline.com/<directory-tenant-id>/v2.0`; the client ID
is the *Application (client) ID*. Add the optional `email` claim to the ID
token (Token configuration), or ensure users' UPN is their email.

**Google Workspace**: Google Cloud console → APIs & Services → Credentials →
OAuth client ID → *Web application*, redirect URI as shown. Issuer
`https://accounts.google.com`.

**Keycloak / Okta / others**: create a confidential OpenID Connect client with
the authorization-code flow and the redirect URI as shown; the issuer is the
realm or authorization-server URL.

Save — the ERP checks it can reach the provider. Test in a private window
before turning off *Also allow passwords for everyone*. With passwords off,
**administrators can still sign in with a password**, so a provider outage
cannot lock everyone out.

The client secret is stored encrypted with a key derived from `AUTH_SECRET`.
If you rotate `AUTH_SECRET`, re-enter each organisation's client secret.

## 5. Alerts and email

SLA alerts appear in each user's alerts bell. To email them as well, set
`SMTP_URL` (for example `smtps://user:password@smtp.example.com:465`) and
`MAIL_FROM`. Reports → *Check SLA alerts now* runs the check immediately.

## 6. Phones and offline field work

Technicians open the ERP's usual address on a phone and get the phone app
(`/m`), which they can install to the home screen. It needs **HTTPS** (the
camera, offline storage and installing all require it; `localhost` is the
only exception) — the reverse proxy in this repository provides it.

- **Assignment**: work orders can be assigned to named people. Grant the
  *Assign work orders to people* permission (`jobs.assign`) to the roles that
  dispatch work, in *Workflow editor → Roles & permissions*. Organisations
  created before this release have it only for ADMIN until you grant it.
- **Proof of work**: in the workflow editor a mandatory field can be a number,
  date, person, photo or signature; photo and signature fields make the step
  wait for one taken on this work order.
- **Asset labels**: *Assets → Print labels* prints A4 sheets of QR labels.
- **Offline**: checklists, notes, photos and meter readings work without a
  signal and are sent when the phone is back online, while the app is open.
  Status changes need a connection. iPhones can clear data for sites that are
  not installed, so ask iPhone users to add the app to the home screen.
- **Kill switch**: if the offline cache ever misbehaves, rebuild the web app
  with `NEXT_PUBLIC_PWA=0`; phones remove the service worker and its caches on
  their next visit. Data already sent is unaffected.

## 7. Stock control

- **Switching it on**: *Settings → Your sector → Modules → Parts catalogue &
  stock control*. New organisations from the general-purpose packs have it on;
  aviation organisations and organisations created before this release have it
  off. When it is switched on and the organisation has no stores, a *Main
  store* at the first site and the standard units (each, set, box, metre,
  litre, kilogram) are created.
- **Stores, units and part groups** are lists in *Workflow editor → Statuses
  & lists*. A store belongs to a site; it cannot be made inactive while it
  still holds stock.
- **Permissions**: *Manage the parts catalogue and stock* (`stock.manage`) —
  catalogue, receipts, adjustments, transfers, counts, import, reorder and the
  stock reports; *Issue parts to work orders* (`stock.issue`). New
  organisations give both to stores, supervisors and managers, and issuing to
  technicians. Organisations created before this release have them only for
  ADMIN until you grant them in *Workflow editor → Roles
  & permissions*.
- **Loading the catalogue**: *Parts & stock → Import from spreadsheet* with a
  CSV of `partNo, name, unit, group, manufacturer, mfrPartNo, store, bin, qty,
  unitCost, reorderPoint, reorderQty` (up to 2,000 rows / 1 MB per file;
  semicolon-separated files with decimal commas are accepted). *Check* first;
  the import is all-or-nothing. Opening stock goes in only where the part has
  no history in that store — after go-live, use a count.
- **Labels**: *Print labels* on the catalogue prints QR labels (choose a store
  first for bin labels). The QR opens the part; on a phone it opens the phone
  part screen.
- **Purchasing**: the *Request parts* step of new organisations offers a
  catalogue part as well as a free description, and *Receive goods* puts
  catalogue parts into stock at the purchase price. In older organisations, add
  a field of type *Catalogue part* to the step and name it in the *Raise a
  parts request* action's part field.
- **Costing**: moving average per part across all stores; issues, counts and
  adjustments use the average at that moment. The ledger is never edited — a
  mistake is put right with an adjustment.

## 8. Request portal

- **Switching it on**: *Settings → Your sector → Modules → Request portal*.
  New organisations from the general-purpose packs have it on; aviation
  organisations and organisations created before this release have it off,
  and while it is off every public address answers *not found*.
- **The link** is the organisation's web address followed by `/r`; *Settings →
  Request portal* shows it with a copy button, and lets you close the form
  (existing requests can still be followed), set an **access code** (asked for
  on the plain form, never from a QR poster), write a short text above the
  form in English and Bahasa Melayu (e.g. the emergency number), choose
  whether to ask the type of problem, and set the **reminder** time.
- **Posters**: *Requests → QR posters* (or *Assets → Request stickers*). Each
  poster carries a random code; switch it off if a poster is taken down or
  misused.
- **Permission**: *Triage requests…* (`requests.manage`). New organisations
  give it to the help desk, supervisors and managers; older ones have it only
  for ADMIN until granted in *Workflow editor → Roles & permissions*.
- **Email**: requesters get emails only when `SMTP_URL` is set; the tracking
  page works without it. Emails never repeat what the requester wrote.
- **Behind a proxy**: set `TRUST_PROXY` so rate limits count real visitors,
  not the proxy. Limits per address: `PORTAL_RATE_LIMIT` submissions a minute
  (default 5) and `PORTAL_HOURLY_LIMIT` an hour (default 20); also three
  requests an hour per email address and at most 500 waiting requests.
- **Personal data**: *Decline* with *spam* deletes the photos and contact
  details; *Erase contact details* on any decided request blanks the name,
  email and phone and stops the tracking link working. The report and work
  orders keep no more than the request's reference.

## 9. Look, money, labour and accounting

**Your look:** *Settings → Look* (administrators).

- **Logo:** PNG or JPEG, at most 512 KB and at least 64 pixels on the short
  side. A wide logo on a transparent background works best. It appears in
  the sidebar, on the sign-in page, the phone app, the request portal, and
  on invoices, delivery notes, work order cards and posters. SVG is not
  accepted, because an SVG file can carry scripts.
- **Brand colour:** replaces the red on buttons, links and the active menu
  item. A colour on which white text would be hard to read (below 4.5:1) is
  refused; choose a darker shade.
- **Default theme:** dark, light, or "match the device". Each person can
  still choose their own in the top bar (phone: *More → Appearance*). The
  choice is kept on their device.

**Currency:** *Settings → Currency and maintenance measures* (administrators).

- **Choosing it:** pick it before anyone records an amount. Once there is an
  invoice, a quotation, a costed stock movement or costed time, the setting
  is locked, because changing it would relabel amounts without converting
  them. If the wrong currency was chosen during setup, `set-currency … --force`
  relabels everything (see *Organisations* above).
- **Where it applies:** every screen, report, PDF and the amount in words use
  it. Tax is rounded to the currency's decimals: none for rupiah, dong and
  yen.
- **For integrators:** API fields keep their `…MYR` names. They hold the
  organisation's currency.

**Preventive grace days:** the second field in the same panel.

- Preventive work done up to this many days after its due date counts as on
  time. The default is 7.
- It feeds the reliability report and the dashboard.

**Labour rates:** *Settings → Labour rates*. You need the permission to
set rates (`labour.manage`); new organisations give it to supervisors and managers.

- **Which rate applies:** a person's own rate is used first, then their
  role's rate, then the organisation default.
- **Rates are kept with the time:** time already logged keeps the rate it was
  logged at.
- **Who sees money:** only people with `labour.manage` see rates and
  labour cost. Everyone else sees hours only.
- **Switching it on:** the *Labour* module is under *Settings → Your sector →
  Modules*. It is off for aviation organisations and for organisations
  created before this release. Give `labour.log` (log your own time) to the
  people who should record time, in *Workflow editor → Roles & permissions*.

**Breakdowns and reliability**

- **Recording downtime:** tick *out of action* when registering work,
  accepting a request, or reporting from the phone. The asset is set out of
  service, and downtime is recorded until that work is done or the asset is
  put back in service.
- **Job types:** the reliability figures treat job types as corrective or
  preventive by their key (`CORRECTIVE`, `PREVENTIVE`). If you renamed or
  added types, set each type's `meaning` in its dictionary entry.
- **The report:** *Reports → Asset reliability* needs `reports.maintenance`.
- **Loading the register:** *Assets → Import CSV*. Download the template,
  fill it in a spreadsheet, and save it as CSV. Every row is checked before
  anything is saved.

**Accounting export:** *Finance → Accounting export*. You need
`accounting.export`; new organisations give it to finance and
managers.

1. Enter the codes from your chart of accounts under *Account codes*. Revenue
   can differ by invoicing stream.
2. Each month, choose the period and *Create batch*. A batch holds:
   - tax invoices raised;
   - payments recorded;
   - goods received on orders;
   - vendor repairs closed.
3. Download it as Excel, or as one CSV per sheet, and import it into your
   accounting system.

Things to know:

- **Nothing twice:** an item goes into one batch only, so nothing is posted
  twice. If a file was lost or rejected, tick *Include items already
  exported* to make a repeat batch.
- **Downloading again:** a batch downloads the same way every time, with the
  codes in force when it was made.
- **Not included:** invoices without a tax invoice number.

## 10. Everyday operations

- **Health**: `GET /api/v1/health` for monitoring.
- **Logs**: one JSON line per request in production.
- **Backups**: see [backup and restore](../operations/backup-and-restore.md).
  Each organisation is a schema in the same database dump; attachments need
  their volume or bucket backed up too.
- **Locked out users**: Users → *Unlock* or *Reset password*.
- **Upgrades**: pull the new version and rebuild; migrations run on start.
  Take a backup first.

## 11. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Sign-in works but every page says *Session has ended* | Web app and API on different sites, so the cookie is not sent — serve them from the same address |
| *No organisation is configured for this address* | `TENANT_STRICT_HOSTS=true` and the address is not registered — `set-hosts` |
| SSO returns to the sign-in page with *no account* | The user's email in the identity provider does not match their ERP account |
| SSO save fails | The issuer URL is wrong or not reachable from the server |
| *Only N … in …* when issuing | Not enough stock in that store; the decrement is checked in the database so stock never goes negative |
| *already has stock history — use a count* on import | That part already has movements in that store; correct its quantity with a count or an adjustment |
| The request page says *not available* | The request portal module is off — *Settings → Modules* |
| Requesters get no emails | `SMTP_URL` not set, or they gave only a phone number — the tracking page still works |
| *Too many requests* for many people at once | Everyone shares one address through a proxy — set `TRUST_PROXY` |
| *Currency is locked* | Money has been recorded; use `tenants-cli set-currency … --force` only to fix a wrong setup choice |
| Logo refused | Not PNG or JPEG, larger than 512 KB, or smaller than 64 px on a side |
| *White text on this colour is hard to read* | Choose a darker brand colour |
| People cannot log time | The *Labour* module is off, or their role lacks `labour.log` |
| Labour cost shows as blank | The person viewing lacks `labour.manage`, by design |
| *Nothing new to export for that period* | Everything in the period is in an earlier batch; tick *Include items already exported* to repeat |
| Alerts but no emails | `SMTP_URL` not set, or the mail server refused — see the API log |
