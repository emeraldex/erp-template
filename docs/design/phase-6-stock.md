# Phase 6 — Stock control: design and build plan

Status: design agreed, not yet built. This file is the brief for the build;
when the phase is done, replace it with `docs/architecture/stock.md`
describing what was built.

## Decisions (owner's choices)

1. **Low stock → alert + one-tap purchase.** Storekeepers get an alert and a
   reorder list; one tap raises a purchase request for the store (no work
   order), which runs through the existing purchasing steps; receiving it puts
   the stock up.
2. **Extras, all in:** stock counts, parts on the phone (online), transfers
   between stores, QR labels for parts and bins.

Core: parts catalogue, stock per store and bin, issue/return to work orders,
receipts updating stock, parts cost per job, spreadsheet import, two reports.

Not in this phase: reservations (available = on hand), FIFO/batch/serial
tracking, expiry dates, multi-currency, purchase orders with several lines
(a request stays one part), stock issue while offline, parts cost on invoices.

Aviation organisations and every existing organisation must behave exactly as
before: the stock module is **off** for them until an administrator switches
it on. All existing tests and `scripts/section8-demo.py` must pass unchanged,
except tests this plan names.

## 1. Module, permissions, lists

- Module `stock` (settings → modules). On for new organisations from the
  general, facilities, fleet, industrial and medical packs; off for aviation
  and for existing organisations (a missing key means off). Switching it on
  when the organisation has no store creates one, `MAIN` ("Main store", at the
  first site). All `/stock` routes are `@InModule('stock')`.
- Permissions: `stock.manage` — catalogue, reorder levels, adjustments, counts,
  transfers, import, raising purchase requests for stock, stock reports;
  `stock.issue` — issue parts to work orders and take returns. Anyone signed
  in can look. Packs: STORES both; SUPERVISOR and MANAGER both; TECHNICIAN
  `stock.issue`; aviation STORES both (inert while the module is off).
  Existing organisations get neither automatically — say so in the upgrade
  notes, as with `jobs.assign`.
- New lists (dictionary kinds, editable under *Statuses & lists*):
  `store` (meta `{ site }`, must be a site key), `unit` (EA, SET, BOX, M, L,
  KG), `partGroup` (per pack). A store that holds stock cannot be made
  inactive. Each maintenance pack seeds `MAIN` and one more store (e.g. a van
  or second site) so transfers can be shown.

## 2. Data model — migration `…_stock`

New tables:

- `parts`: `id` (PRT-YYYY-NNNN), `partNo` (unique; the organisation's code),
  `name`, `description`, `unit`, `group`, `manufacturer`, `mfrPartNo`,
  `preferredSupplierId` (nullable), `avgCost` DECIMAL(14,4) default 0,
  `lastCost` (nullable), `active`, `attributes` JSON, `createdAt/By`,
  `version`.
- `stock_levels`: `partId`, `store`, `bin` (text), `qty` DECIMAL(14,3) default
  0, `reorderPoint`, `reorderQty` (nullable), `lowSince` (nullable),
  `countedAt` (nullable); unique (`partId`, `store`); a database
  `CHECK (qty >= 0)` as a backstop (raw SQL in the migration).
- `stock_movements` (append-only ledger): `id`, `partId`, `store`, `type`
  (OPENING · RECEIPT · ISSUE · RETURN · ADJUST · COUNT · TRANSFER_OUT ·
  TRANSFER_IN), `qty` signed DECIMAL(14,3), `unitCost` DECIMAL(14,4),
  `balanceAfter`, `jobId`, `demandId`, `countId`, `transferRef` (all nullable),
  `reason`, `by`, `at`; indexes (`partId`, `at`), (`jobId`), (`store`, `at`).
- `stock_counts`: `id` (CNT-YYYY-NNNN), `store`, `status` (OPEN · POSTED ·
  CANCELLED), `startedBy/At`, `postedBy/At`, `note`; `stock_count_lines`:
  `countId`, `partId`, `systemQty` (snapshot), `countedQty` (nullable); unique
  (`countId`, `partId`).

Changes to `demands` (hand-written SQL; check row values are unchanged on a
copy of the test database before and after):

- `partId` TEXT NULL, `forStore` TEXT NULL, `unitCost` DECIMAL(14,4) NULL;
- `qty` INT → DECIMAL(14,3) `USING qty::numeric` (oil in litres, cable in
  metres); the API still returns a number;
- `jobId` DROP NOT NULL (a purchase request for stock has no work order).

Everything else is additive. No `DROP`.

## 3. Rules

- Quantities: more than zero, up to 3 decimals. Stock never goes below zero:
  decrement with a conditional update (`… WHERE qty >= n`) in the same
  transaction as the ledger row; if it matches nothing, refuse with "Only 2 EA
  in Main store (3 needed)".
- Cost: moving average per part across the organisation. A receipt sets
  `avg = (onHand × avg + qty × cost) ÷ (onHand + qty)` with the part row locked
  for the transaction, and sets `lastCost`. Issues, returns, transfers,
  adjustments and counts use the average at that moment; every ledger row
  stores its `unitCost`. Opening balances from the import set the average.
- A job's parts cost = Σ over its ledger rows (issues − returns) of
  `qty × unitCost`. Only catalogue parts count.
- Returns: not more than was issued to that job, net. Issues and returns are
  refused on closed or archived jobs.
- Adjustments need a reason. The ledger is never edited; a mistake is
  corrected by another movement.
- Low stock: after any movement, if a store's quantity is at or below its
  reorder point and `lowSince` is empty, set it and notify people with
  `stock.manage` once ("Low stock: Brake pads — 2 EA left in Main store");
  clear `lowSince` when it rises above. No repeat alerts while it stays low.

## 4. API (`/stock`, module-gated)

- Parts: `GET /stock/parts?q=&group=&store=&low=1`, `POST`, `GET /stock/parts/:id`
  (levels per store, last 50 movements, open requests), `PATCH`;
  `PUT /stock/parts/:id/levels/:store` `{ bin, reorderPoint, reorderQty }`.
- Movements: `POST /stock/issue` and `/stock/return`
  `{ partId, store, qty, jobId }` (`stock.issue`; honour `X-Client-Op`);
  `POST /stock/adjust` `{ partId, store, qty (signed), reason }`;
  `POST /stock/transfer` `{ partId, from, to, qty }` (two ledger rows sharing a
  `transferRef`, one transaction); `GET /stock/movements?partId=&store=&jobId=&from=&to=`.
- Reorder: `GET /stock/reorder` — low items with a suggested quantity
  (`reorderQty`, else reorder point × 2 − on hand, at least 1) and any open
  request for that part and store; `POST /stock/reorder`
  `{ items: [{ partId, store, qty }] }` raises one purchase request per item at
  the DEMAND workflow's first status with `partId`, `forStore`, no job. An
  item that already has an open request is refused.
- Counts: `POST /stock/counts` `{ store, group? }` snapshots the lines;
  `PATCH /stock/counts/:id` `{ lines: [{ partId, countedQty }] }`;
  `POST /stock/counts/:id/post` — for each counted line the difference
  (counted − snapshot) is applied to the **current** quantity as a COUNT
  movement, so issues made during the count are kept; a line that would go
  below zero stops the post, naming it. Uncounted lines are untouched.
  `POST /stock/counts/:id/cancel`. One open count per store.
- Import: `POST /stock/import?dryRun=1` — CSV with columns `partNo, name, unit,
  group, manufacturer, mfrPartNo, store, bin, qty, unitCost, reorderPoint,
  reorderQty`; up to 2,000 rows / 1 MB; every row validated, errors listed by
  row; applied all-or-nothing. Parts are created or updated by `partNo`. An
  opening quantity is accepted only where that part and store have no ledger
  rows yet (otherwise: "already has stock history — use a count").
- Labels: `GET /stock/labels?ids=` — the asset label sheet generalised: QR →
  `<web>/stock?part=<id>`, part number, name, bin.
- Jobs: `GET /jobs/:id/parts` → lines (part, net quantity, cost) and the total;
  also in the job pack as `parts`.
- Reports (`stock.manage`, xlsx/csv through the existing report builder):
  `/reports/stock-valuation` (per store: part, quantity, average cost, value,
  totals) and `/reports/parts-usage?from&to` (issues net of returns by part
  and work order/asset, with cost).
- Dashboard: a "low stock" count when the module is on.

## 5. Workflow integration

Step fields gain two things:

- **Optional fields** — `optional: true`. Shown without an asterisk, skipped
  by the mandatory check, type-checked when filled. A field an action *needs*
  cannot be optional (validator error). This also makes fields such as the
  single-source approval or the discrepancy note enterable, which today no
  screen offers.
- **Two types** — `part` (searchable catalogue picker; audit shows
  "partNo — name") and `store` (pick from the store list; audit shows its
  name).

Actions (existing organisations keep their behaviour: stock only moves when
the module is on **and** the request has a catalogue part):

| Action | Change |
|---|---|
| `raiseDemand` (work orders) | New optional setting `partField`. With a part chosen, the request carries `partId` and takes its description and number from the catalogue; otherwise the description is needed: "Choose a part from the catalogue or describe what is needed". |
| `issueFromStock` (requests) | For a catalogue part: takes the request's quantity out of the store in the holding field (now a `store` field; if absent, the store it was received into) and, when the request belongs to a work order, records the issue against it. Refused when there is not enough. Otherwise as before. |
| `recordReceipt` (requests) | New optional settings `storeField`, `qtyField`, `costField`. For a catalogue part: puts the received quantity (default: the requested one) into the store (default: `forStore`, else `MAIN`) at the unit cost (default: the chosen quotation's price ÷ requested quantity — a quotation's price is for the whole request), remembers the store on the request, and — when the request has **no** work order — closes it ("Received into stock"). |
| `recordStockCheck` | For a catalogue part, the audit entry also notes what is on hand. Nothing else changes. |

Pack updates (new organisations only): *Request parts* gets `part` (optional,
type part), `partDescription` (optional) and `qty`; *Issue from stock* takes a
`store`; *Receive goods* gets `store`, optional `unitCost` and optional
received quantity; *Issue to work order* gets `issueFromStock`. The requests
workflow's final status is relabelled "Fulfilled" (key `ISSUED` unchanged).
Requests show "In stock: 5 EA in Main store" for catalogue parts. The
maintenance demo data gains about ten parts per pack with stock, a few below
their reorder point.

## 6. Screens

Desktop (`/stock`, shown when the module is on; wording via `useVocab`):

- **Stock** — parts with on-hand per store, value, a *Low* filter, search;
  add part; import (dry-run report, then apply); print labels.
- **Part** — details, levels per store with bin and reorder settings, ledger,
  open requests, buttons for adjust, transfer, issue.
- **Reorder** — the low list with editable suggested quantities and "Raise
  purchase request(s)".
- **Counts** — start a count for a store, enter quantities (keyboard-friendly
  table), see differences and value, post or cancel.
- Work order page: **Parts used** with cost, and issue/return for people with
  `stock.issue`.
- Purchasing page: requests for stock are marked "For stock — ‹store›" and
  have no work order link.
- Workflow editor: the *optional* tick and the two new field types.
- Settings → modules: the stock switch.

Phone (online only; disabled offline with the usual "needs a connection"):

- Job screen: **Parts used** — pick a part (search), store and quantity, with
  what is on hand shown; return unused.
- `/m/part?id=` — a part's stock by store, opened from a bin or part label;
  narrow screens opening `/stock?part=` forward there.

All new strings in English and Bahasa Melayu.

## 7. Tests

API unit: moving average (several receipts, issues in between); conditional
decrement; return limit; count posting with movements during the count;
low-stock alert fires once and re-arms; optional fields and the two types in
the resolver and validator; every pack still valid.

API e2e (the fleet organisation, plus aviation for "nothing changed"):
catalogue CRUD and permissions; issue/return against a work order and the
job's parts cost; insufficient stock; two issues racing for the last unit —
exactly one succeeds; transfer; adjustment needs a reason; count; import
dry-run errors and all-or-nothing apply; reorder → purchase request without a
work order → quotations → order → receive into stock → average cost updated →
request closed; a work-order request for a catalogue part issued from stock,
and one bought, received and issued; `X-Client-Op` on issue; module off →
`403 MODULE_OFF`; an aviation request still runs its original steps with the
module off; reports; labels PDF.

Migration check on an upgraded copy: demand rows identical before and after
(quantities equal as numbers).

Browser run (desktop and emulated phone, with screenshots; extend
`scripts/phone-offline-check.js` or add a sibling script): add a part, issue
it on the phone to a work order, see stock fall and the job's parts cost,
trigger a low-stock alert, raise the purchase request from the reorder list.

Regression: all existing tests and the Section 8 script.

## 8. Build order

1. Migration; lists, module and permissions; parts and levels API; tests.
2. Ledger: issue, return, adjust, transfer, low-stock alerts, job parts cost;
   tests including the race.
3. Optional fields and the `part` / `store` types; action changes; purchase
   requests without a work order; reorder; pack and demo-data updates; tests.
4. Counts, import, labels, reports, dashboard count; tests.
5. Desktop screens.
6. Phone: parts on the job screen and the part screen.
7. Browser run and screenshots; docs (user guide + panduan pengguna "Stock",
   admin guide, sectors guide, API guide, README); replace this file with the
   architecture note; CI green; push. Ask before opening a pull request.

Stop and hand back to design (Fable) if: making `jobId` optional on requests
would change any aviation behaviour or needs a wider rewrite than the request
service and its screens; the moving-average rule cannot be kept correct under
concurrent receipts; or a pack's request workflow cannot express the
stock-replenishment path with the actions above.
