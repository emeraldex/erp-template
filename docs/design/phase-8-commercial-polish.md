# Phase 8 design: commercial polish

Removes the reasons a non-aviation buyer hesitates: the look, the paperwork,
what work costs, how reliable the assets are, and getting figures into the
accounts.

## Decisions (from the product owner)

1. **In scope:** look and documents; labour and job cost; reliability reports
   and asset import; accounting export.
2. **Currency: full multi-currency** — split in two. This phase gives each
   organisation **its own currency** everywhere (the foundation). **Phase 9**
   adds a currency and exchange rate per quotation, purchase and invoice.
3. **Accounting export:** one generic layout (Excel and CSV) with the
   client's own account codes. No package-specific formats.
4. **Malaysian e-Invoicing (MyInvois):** not in this phase.

Aviation organisations and every existing organisation behave as before:
currency stays Ringgit, the dark theme stays the default, aviation documents
keep their form numbers, and the new `labour` module is off for them.

Not in this phase: transaction currencies and exchange rates (Phase 9),
overtime rates, attendance or payroll, labour or parts on invoice lines,
credit notes, 3-decimal currencies, client-specific app icons, e-Invoicing.

## 1. The organisation's currency

- Settings block `currency`: `code` (from a built-in list of about 25 —
  MYR, SGD, IDR, THB, PHP, VND, BND, USD, EUR, GBP, AUD, NZD, INR, AED, SAR,
  HKD, CNY, JPY…), with its `symbol`, `decimals` (0 or 2) and the words for
  invoices ("Ringgit Malaysia" / "Sen"). Default MYR.
- `PATCH /settings/currency` (`org.admin`). **Locked once money exists** (an
  invoice, quotation, stock movement or costed time entry): changing it would
  relabel amounts without converting them. `tenants-cli set-currency <org>
  <code> --force` relabels deliberately.
- Every screen, report heading, PDF and the amount in words use it. `/config`
  and `/tenant` carry it.
- Stored and API field names keep their `…MYR` suffix (`totalMYR`,
  `priceMYR`): renaming them would break integrations. The API guide says
  they are "in the organisation's currency".

## 2. Look: theme, colour and logo

- **Light theme.** Colours are already CSS variables; a second set applies
  under `data-theme="light"`. Text meets WCAG AA contrast (4.5:1) in both.
  The ten hard-coded colours in components move to variables.
- **Choice:** each person picks dark, light or "match my device" (top bar;
  phone *More*); kept on the device. The organisation sets the default. A
  small inline script applies it before first paint, so there is no flash.
- **Brand colour.** Settings `brand.accent` (`#RRGGBB`) replaces the red on
  buttons, active menu items and links. Refused if white text on it would
  fall below 4.5:1 ("choose a darker colour"). The brighter hover shade is
  derived.
- **Logo.** `PUT /settings/logo` (`org.admin`): PNG, JPEG or WebP by content,
  at most 512 KB, at least 64 px on the short side. No SVG — it can carry
  scripts. `DELETE /settings/logo`. Served by the public `GET /tenant/logo`
  (the sign-in page and the request portal need it before anyone signs in),
  with `nosniff`, an ETag and an hour's caching.
- **Where they show:** the sidebar, sign-in page, phone app header, request
  portal, and the PDFs — invoice, covering letter, delivery note, job card,
  request posters.

## 3. Documents without aviation numbers

For non-aviation organisations:

- "Tax Invoice (F311)" → "Tax invoice" (or "Invoice" when the tax rate is
  0); "DN no. (F218)" → "Delivery note no."; the job card loses "QP.44";
  dates are found by what a record is, not by its form number.
- The twelve places on screens that still print F-numbers or QP references
  without checking go through the existing `ref()` helper.

Aviation output is unchanged; a test pins its wording.

## 4. Labour and job cost

Module `labour` (on for the general-purpose packs, off for aviation and
existing organisations). Permissions: `labour.log` — log your own time
(technicians, supervisors); `labour.manage` — log or correct anyone's, see
rates and costs, set rates (supervisors, managers).

- **Time entries** (`time_entries`): work order, person, work date, minutes,
  note, the **rate at the time** and the cost. Rates: a person's own
  (`users.hourlyRate`) → their role's (`settings.labour.roleRates`) → the
  organisation default. Later rate changes do not rewrite history.
- **Rules:** 1 minute to 24 hours per entry, and per person per day; not in
  the future; not on a closed or archived work order; you may change or
  remove your own while the work order is open. Each entry is noted on the
  work order ("Time logged: 1 h 30 min by Ravi").
- **Privacy:** everyone on the work order sees hours. Rates and labour cost
  show only with `labour.manage`.
- **Job cost** (`GET /jobs/:id/cost`): parts from stock (the ledger) +
  direct purchases (requests for non-catalogue parts, at the chosen
  quotation's price) + vendor repairs + labour. Catalogue parts bought for
  the job count once, when issued from stock.
- **Phone:** a *Time* section on the work order — 15 min, 30 min, 1 h, 2 h
  or your own figure, and a start/stop timer kept on the phone. Works
  offline through the existing outbox (`X-Client-Op`).
- **Report** `/reports/labour?from&to` (`labour.manage`): hours and cost by
  person and by work order.

## 5. Reliability, downtime and asset import

**New facts recorded** (migration, additive):

- `jobs.doneAt` — when the work order last entered a *done* phase. Older work
  orders fall back to their audit trail.
- `jobs.pmDueAt` — the due date of the preventive cycle that raised it.
- `jobs.assetDown` — "the asset is out of action": a tick when registering
  work, accepting a portal request or reporting from the phone.
- `asset_downtime` — asset, from, to, work order, reason. Opened when an
  asset goes *out of service* (by that tick or by hand), closed when the work
  order is done or the asset is put back in service. One open record per
  asset.
- Job types gain a meaning (`corrective`, `preventive`, `other`) so
  organisations can rename them; existing lists are classified by their keys.

**Measures**, for a period, per asset:

| Measure | Definition |
|---|---|
| Failures | Corrective work orders received in the period |
| Downtime | Hours of downtime records overlapping the period |
| Availability | 1 − downtime ÷ hours in the period (from commissioning, if later) |
| Mean time to repair | Average of received → done, corrective work completed in the period |
| Mean time between failures | (Hours in the period − downtime) ÷ failures; blank with no failures |
| PM compliance | Preventive work due in the period done by its due date + grace (`pmGraceDays`, default 7) ÷ preventive work due in the period. Meter-only cycles are listed, not scored |
| Cost | Parts + purchases + vendor repairs + labour of work done in the period |

- **Report** `/reports/reliability?from&to` (new permission
  `reports.maintenance`: supervisors, managers): by asset; by type and site;
  preventive work with due and done dates.
- **Asset page:** the last 12 months — failures, downtime, availability,
  repair time, cost — and the downtime history.
- **Dashboard:** assets out of service now; PM compliance over 90 days.

**Asset import** — `POST /assets/import?dryRun=1` (`assets.manage`), like the
parts import: CSV of `tag, name, type, site, location, make, model, serialNo,
criticality, status, parentTag, commissionedOn, meterKey, meterLabel,
meterUnit, meterValue`; matched by tag; parents may be in the same file;
loops refused; types and sites by code or name; 2,000 rows / 1 MB; every
row's problems listed; all or nothing.

## 6. Accounting export

Module `invoicing`; new permission `accounting.export` (finance, managers).

- **Account codes** (settings `accounting`): receivables, bank, output tax
  and its tax code, purchases, stock, and a revenue account per invoice
  stream with a default.
- **Batches.** `POST /accounting/exports { from, to }` gathers what has not
  been exported before and records a batch (`accounting_exports`,
  `accounting_export_items`), so nothing is exported twice;
  `includeExported` repeats deliberately. `GET /accounting/preview?from&to`
  shows what a batch would hold. Batches can be downloaded again.
- **Three sheets** (Excel; CSV one sheet at a time):
  - *Sales* — tax invoices raised: number, date, customer, description,
    stream, work order, currency, net, tax code, rate, tax, total, revenue
    and receivable accounts.
  - *Receipts* — payments recorded: date, invoice, customer, amount,
    reference, bank and receivable accounts.
  - *Purchases* — goods received and vendor repairs closed: reference, date,
    supplier, description, quantity, amount, account (stock for catalogue
    parts, otherwise purchases), work order.
- An invoice with no tax invoice number is not exported.

## 7. Tests

Unit: money formatting and words for 0- and 2-decimal currencies; contrast
check; rate resolution and cost; reliability measures on fixed data; asset
import validation (parents, loops); export batching.

Integration: currency lock and relabelling; logo upload limits and public
serving; non-aviation and aviation PDF wording; time entries (rules, privacy
of rates, offline replay), job cost without double counting; downtime opened
and closed by work orders and by hand; the reliability, labour and export
files; asset import dry run and all-or-nothing; modules off; aviation
untouched; `scripts/section8-demo.py` unchanged.

Browser (`scripts/polish-check.js`): brand a facilities demo (logo, colour,
light theme), log time on the phone offline, complete breakdown work, check
job cost, the asset's reliability block, an invoice PDF, and an export batch;
screenshots in both themes.

## 8. Build order

1. Organisation currency.
2. Theme, brand colour, logo; documents without aviation numbers.
3. Labour: time entries, rates, job cost, report.
4. Reliability: recorded facts, measures, report; asset import.
5. Accounting export.
6. Screens: settings (currency, brand, labour rates, account codes), time
   and cost on the work order (desktop and phone), asset reliability,
   dashboard, export page, asset import.
7. Browser run in both themes, documentation (this document becomes
   `docs/architecture/costs-and-reliability.md` and a branding section in
   the administrator guide), CI checks, push.
