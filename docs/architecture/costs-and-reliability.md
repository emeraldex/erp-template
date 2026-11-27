# Money, look, labour, reliability and the accounting export

This release covers the things a buyer outside aviation checks first: the
organisation's own currency, its logo and colours, plain paperwork, what work
costs, how reliable the assets are, and getting the figures into the
accounts. Aviation organisations and organisations created before this
release behave as before: Ringgit, the dark theme, form numbers on
documents, and the `labour` module off.

Not covered yet: a currency and exchange rate per quotation, purchase or
invoice (planned for the next phase), overtime, attendance or payroll,
labour or parts on invoice lines, credit notes, 3-decimal currencies,
client-specific app icons, and Malaysian e-Invoicing (MyInvois).

## 1. The organisation's currency

Code: `apps/api/src/settings/currency.ts` (list, rounding, formatting),
`documents/words.ts` (amount in words), `common/money.ts` (tax).

- 28 currencies (MYR, SGD, BND, IDR, THB, PHP, VND, KHR, USD, EUR, GBP, AUD,
  NZD, INR, AED, SAR, HKD, CNY, JPY, …), each with a symbol, 0 or 2 decimals
  and the words for invoices ("Ringgit Malaysia … and Sen Fifty Only",
  "Rupiah … Only"). Default MYR.
- `GET /settings/currencies` returns `{ current, locked, list }`;
  `PATCH /settings/currency { code }` (`org.admin`). It is **locked once money
  is recorded** (an invoice, a quotation, a stock movement with a cost, or a
  costed time entry): changing it would relabel amounts without converting
  them. `tenants-cli set-currency <id|default> <code> --force` relabels on
  purpose; `tenants-cli create … --currency SGD` starts an organisation in
  another currency.
- Screens, report headings ("Cost (SGD)"), PDFs and the amount in words
  follow it. Tax is rounded to the currency's decimals. `/config` and
  `/tenant` carry it; the web app's `setCurrency` makes `fmtMoney` follow.
- Stored and API field names keep their `…MYR` suffix (`totalMYR`,
  `priceMYR`, `costMYR`): renaming them would break integrations. They hold
  amounts in the organisation's currency.

## 2. Look: theme, colour and logo

Code: `settings/brand.ts` (contrast, image checks), `settings.service.ts`,
`tenant.controller.ts` (public logo), `apps/web/lib/brand.tsx`,
`app/globals.css`.

- **Themes.** All colours are CSS variables; a light set applies under
  `<html data-theme="light">`. Text meets WCAG AA (4.5:1) on every surface in
  both themes (`test/unit/brand.spec.ts` checks the pairs). Each person
  chooses dark, light or "match my device" in the top bar or the phone's
  *More* page; the choice is kept in the browser. The organisation sets the
  default (`brand.defaultTheme`). An inline script in the page head applies
  the theme before first paint, so there is no flash.
- **Brand colour.** `PATCH /settings/brand { accent, defaultTheme }`
  (`org.admin`). `accent` (`#RRGGBB`) replaces the red on buttons, active menu
  items and links, with a lighter hover shade derived from it. It is
  refused when white text on it falls below 4.5:1.
- **Logo.** `PUT /settings/logo` (multipart `file`, `org.admin`): PNG or JPEG,
  recognised by content not by name, at most 512 KB and at least 64 px on the
  short side. SVG is refused because it can carry scripts. WebP is refused
  because the PDF library cannot embed it. `DELETE /settings/logo` removes it.
  The image is kept in the organisation's settings (setting `logo`), cached in
  memory per organisation, and served by the public `GET /tenant/logo`. That
  route is public because the sign-in page and the request portal need it
  before anyone signs in. It sends `nosniff`, `Content-Security-Policy:
  default-src 'none'`, an ETag (304 on repeat), an hour's caching and
  `Cross-Origin-Resource-Policy: cross-origin`. `/tenant` gives
  `brand.logo` as a short hash, so the URL changes when the logo does.
- **Where it shows:** sidebar, sign-in page, phone header, request portal,
  and the PDFs: tax invoice, covering letter, delivery note, work order card,
  and request posters.

## 3. Documents without aviation numbers

For organisations that are not aviation (`DocumentsService.aviation`):

- the tax invoice is titled "Tax invoice", or "Invoice" at a 0% tax rate;
- "DN no. (F218)" becomes "Delivery note no.";
- the job card is a "WORK ORDER CARD" without QP references;
- the dates of tax invoices are found by what a record is (a record holding
  the invoice number, else form F311, else the audit entry that recorded the
  number), not by its form number.

Screens that showed F-numbers unconditionally ("Total (F311)", the F225
chips) now check `aviation`. Aviation output is unchanged, and the tests pin
its wording.

## 4. Labour and job cost

Code: `apps/api/src/labour/`, `components/labour/job-time.tsx`,
`components/m/time.tsx`, `components/settings/labour-rates.tsx`.

Module `labour`: on for the general-purpose packs, off for aviation and for
organisations created before it. Permissions: `labour.log` lets a person log
their own time (technicians, supervisors). `labour.manage` lets a person log
or correct anyone's time, see rates and labour cost, and set rates
(supervisors, managers).

| Table | Holds |
|---|---|
| `time_entries` | work order, person (id and name), work date, minutes, note, **rate and cost at the time**, who logged it |
| `users.hourlyRate` | a person's own rate (optional) |

- **Rate** = the person's own → their role's (`settings.labour.roleRates`) →
  the organisation default (`settings.labour.defaultRate`), else none (cost
  0). The rate is copied onto the entry, so later changes never rewrite what
  was logged.
- **Rules:** whole minutes, 1 to 1,440 per entry; at most 24 hours per
  person per day; not in the future; only on an open work order. You may
  change or remove your own entries while the work order is open;
  `labour.manage` may change anyone's. Each entry is noted on the work
  order: "Time logged: 1 h 30 min by Ravi Kumar on 2026-11-27 — Replaced
  belt".
- **Privacy:** everyone who can see the work order sees hours. Rates, labour
  cost and totals that include labour appear only with `labour.manage`. That
  covers the API response (fields left out or `null`), the screens, and the
  asset cost in reliability figures (shown also with `reports.maintenance`).
- **Routes:** `GET|POST /jobs/:id/time`, `PATCH|DELETE /time/:id`,
  `GET /jobs/:id/cost`, `GET|PUT /labour/rates`,
  `PUT /labour/people/:id/rate`. `POST /jobs/:id/time` honours `X-Client-Op`,
  so a phone that resends after a dropped connection is answered
  `{ duplicate: true }`.
- **Job cost** adds four sources:
  - parts from the stock ledger (issues minus returns, at their recorded cost);
  - direct purchases of non-catalogue parts ordered for the job, at the chosen
    quotation's price;
  - vendor repairs with a cost;
  - labour.

  Catalogue parts bought for a job count once, when they are issued from stock.
- **Phone:** a *Time* section on the work order: +15 min, +30 min, +1 h,
  +2 h, your own figure, and a start/stop timer that is kept on the phone
  (it survives closing the app). Entries go through the offline outbox like
  notes and photos.
- **Report** `/reports/labour?from&to` (`labour.manage`): hours, entries,
  work orders and cost by person and by work order.

## 5. Downtime, reliability and asset import

Code: `apps/api/src/assets/downtime.service.ts`, `reliability.ts` (pure
measures), `reliability.service.ts`, `import.service.ts`,
`components/assets/reliability.tsx`.

**Facts recorded** (additive migration):

| Field / table | Meaning |
|---|---|
| `jobs.doneAt` | When the work order last reached a *done* or *closed* phase. Older work orders fall back to their audit trail |
| `jobs.pmDueAt` | Due date of the preventive cycle that raised it |
| `jobs.assetDown` | "The asset is out of action": the tick when registering work, accepting a portal request, or reporting a problem from the phone. Needs an asset |
| `asset_downtime` | asset, from, to, work order, reason, opened/closed by |

A downtime spell opens when an asset goes out of service, either through the
tick (the asset is set *out of service*) or by hand on the asset page. It
closes when that work order is done or closed, or when the asset is put back
in service. An asset has at most one open spell. Each open or close takes a
transaction-level advisory lock on the asset. A partial unique index was not
used, because the schema tool would try to drop it on every later migration.

Job types have a **meaning**: `corrective`, `preventive` or `other`. It
comes from the job type's dictionary `meta.meaning`, so organisations can
rename their types; when that is not set, it comes from the keys
`CORRECTIVE` and `PREVENTIVE`. Work raised by a preventive schedule always
counts as preventive.

**Measures** for a period, per asset (`measure()` in `reliability.ts`):

| Measure | Definition |
|---|---|
| Failures | Corrective work orders received in the period |
| Downtime | Hours of downtime spells overlapping the period |
| Availability | 1 − downtime ÷ hours in the period (from commissioning, if later) |
| Mean time to repair | Average received → done, corrective work completed in the period |
| Mean time between failures | (hours in the period − downtime) ÷ failures; blank with no failures |
| Preventive on time | Preventive work due in the period that was done by due date + grace (`settings.maintenance.pmGraceDays`, default 7, `PATCH /settings/maintenance`) ÷ preventive work due. Cycles due on a meter only are counted apart, not scored |
| Cost | Job cost (above) of work done in the period |

- `GET /assets/:id/reliability[?months=12]`: the asset page block, plus its
  last 20 downtime spells. Cost is `null` unless the viewer has
  `labour.manage` or `reports.maintenance`.
- `/reports/reliability?from&to` (new permission `reports.maintenance`:
  supervisors, managers): by asset, by type and site, and preventive work.
- Dashboard (`/dashboard/kpis`): `assetsDown` (assets out of service now;
  `null` when the asset register is off) and `pmCompliance90`.

**Asset import:** `POST /assets/import[?dryRun=1]` (multipart `file`,
`assets.manage`). It takes a CSV with the columns `tag, name, type, site,
location, make, model, serialNo, criticality, status, parentTag,
commissionedOn, meterKey, meterLabel, meterUnit, meterValue`. Only `tag` is
required in the header, and a new tag needs a name, type and site.

- Rows are matched by tag (ignoring case): new tags are created and existing
  ones updated. Empty cells leave a field as it is.
- Types and sites can be given by code or name. A parent may be in the same
  file, and loops are refused.
- Limits: 2,000 rows and 1 MB.
- Every row is checked first, and the reply lists each problem with its row
  number. Nothing is written unless every row is good. The screen always
  runs a dry run first.

## 6. Accounting export

Code: `apps/api/src/accounting/`, `app/(erp)/accounting/page.tsx`.

Needs the `invoicing` module and the new permission `accounting.export`
(finance and managers; finance in aviation).

- **Account codes** (`GET|PUT /accounting/settings`): receivables (1200),
  bank (1000), output tax (2200) and its tax code (SR), purchases (5000),
  stock (1300), and revenue by invoicing stream with a default (4000).
- **Batches.** `GET /accounting/preview?from&to` counts what a batch would
  hold and what earlier batches already hold.
  `POST /accounting/exports { from, to }` records a batch `EXP-YYYY-NNNN`
  (`accounting_exports`, `accounting_export_items`) with only items not
  exported before. An advisory lock stops two people exporting the same
  item at once. `includeExported: true` repeats on purpose (marked
  *REPEAT*), for when a batch was lost or rejected by the accounting system.
  "Nothing new to export for that period" means there is nothing to add.
- Each item keeps a **copy of its row**, account codes included, so
  downloading a batch again gives the same file even after codes or records
  change. Use `GET /accounting/exports` for the list and
  `GET /accounting/exports/:id/file` for the file: Excel by default, or
  `?format=csv&sheet=sales|receipts|purchases`.
- **Sheets:**
  - *Sales:* tax invoices dated in the period. Columns: number, date,
    customer, description, stream, work order, currency, net, tax code, rate,
    tax, total, and the revenue, receivable and tax accounts.
  - *Receipts:* payments recorded in the period. Columns: date, invoice,
    customer, amount, reference, and the bank and receivable accounts.
  - *Purchases:* two kinds of line.
    - Goods received on an order, dated by the step that records the
      receipt, at the chosen quotation's price. The account is stock for
      catalogue parts, otherwise purchases.
    - Vendor repairs closed with a cost.
- An invoice without a tax invoice number is not exported.

## 7. Tests and checks

- Unit tests:
  - `money.spec.ts`: currencies, words, tax rounding;
  - `brand.spec.ts`: contrast, image checks, theme pairs;
  - `labour.spec.ts`: durations, rate resolution;
  - `reliability.spec.ts`: measures on fixed data.
- Integration tests:
  - `currency`: lock, relabelling, SGD organisation;
  - `branding`: logo limits, public serving, PDFs, plain documents;
  - `labour`: rules, privacy, offline replay, job cost, report, aviation off;
  - `reliability`: downtime by work order and by hand, PM due dates, report,
    dashboard, import;
  - `accounting`: codes, preview, once-only batches, files.
- Browser: `scripts/polish-check.js` (28 checks) against a fresh facilities
  demo. The flow:
  1. Logo, colour (a pale colour is refused) and the light theme.
  2. Labour rates set from settings.
  3. A breakdown registered with the asset out of action.
  4. Time logged on an emulated phone with no signal, reaching the server once.
  5. Job cost, which a technician cannot see.
  6. Asset reliability and closed downtime, and the dashboard cards.
  7. The tax invoice PDF with the logo, and an accounting batch downloaded as
     Excel and CSV.
