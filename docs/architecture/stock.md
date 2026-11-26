# How stock control works

The `stock` module adds a parts catalogue, stock per store and bin, and a
ledger of every change. It is **on** for new organisations from the general,
facilities, fleet, industrial and medical packs, and **off** for aviation
organisations and organisations created before it existed — for them nothing
changes until an administrator switches it on. Every `/stock` route answers
`403 MODULE_OFF` while it is off.

Code: `apps/api/src/stock/` (`stock.service.ts` — catalogue and ledger;
`counts.service.ts`; `import.service.ts` and `csv.ts`), the stock reports in
`src/reports/reports.service.ts`, the workflow actions in
`src/demands/demands.service.ts` and `src/jobs/jobs.service.ts`. Screens:
`apps/web/app/(erp)/stock`, `components/stock/`, `app/m/part`,
`components/m/job-parts.tsx`.

## Lists and permissions

- Dictionary kinds, editable under *Statuses & lists*: `store` (meta `{ site }`,
  an active site), `unit` (EA, SET, BOX, M, L, KG), `partGroup`. A store that
  still holds stock cannot be made inactive. Switching the module on in an
  organisation with no stores creates `MAIN` at the first site and the units.
- `stock.manage` — catalogue, store settings, receipts, adjustments,
  transfers, counts, import, reorder, the stock reports. `stock.issue` — issue
  to and return from work orders. Anyone signed in can look.

## Data

| Table | Holds |
|---|---|
| `parts` | `PRT-YYYY-NNNN`, the organisation's unique `partNo`, name, unit, group, maker, `avgCost`, `lastCost`, `active`, `version` |
| `stock_levels` | One row per part and store: `bin`, `qty`, `reorderPoint`, `reorderQty`, `lowSince`, `countedAt`. `CHECK (qty >= 0)` |
| `stock_movements` | The ledger, append-only: type (OPENING · RECEIPT · ISSUE · RETURN · ADJUST · COUNT · TRANSFER_OUT · TRANSFER_IN), signed `qty`, `unitCost`, `balanceAfter`, and the `jobId` / `demandId` / `countId` / `transferRef` it belongs to, `reason`, `by`, `at` |
| `stock_counts`, `stock_count_lines` | `CNT-YYYY-NNNN`, store, OPEN · POSTED · CANCELLED; per line the snapshot `systemQty` and the `countedQty` |

Demands (purchase requests) gained `partId`, `forStore` and `unitCost`; their
`qty` became DECIMAL(14,3) (litres, metres) and `jobId` became optional (a
purchase for stock has no work order). The migration converts in place — on an
upgraded copy every existing request was unchanged.

## Rules

- **Never below zero.** A decrement is a conditional update
  (`UPDATE … SET qty = qty - n WHERE qty >= n`) in the same transaction as its
  ledger row; if no row matches, the request is refused ("Only 2 Each of BP-100
  in Main store (3 needed)"). The CHECK constraint is a backstop. Two people
  taking the last unit at once: exactly one succeeds.
- **One part at a time.** Every movement first updates the part's row
  (`version + 1`), which locks it until the transaction ends, so a part's
  movements and its average cost are applied in order.
- **Moving-average cost** per part across all stores. A receipt sets
  `avg = (onHand × avg + qty × cost) ÷ (onHand + qty)` and `lastCost`.
  Issues, returns, transfers, adjustments and counts use the average at that
  moment; each ledger row keeps its `unitCost`.
- **A work order's parts cost** is Σ (issues − returns) × `unitCost` over its
  ledger rows. Returns are limited to what was issued to that work order, net.
  Closed or archived work orders take no issues or returns.
- **Adjustments need a reason.** The ledger is never edited; a mistake is put
  right with another movement.
- **Low stock**: after a movement, a store at or below its reorder point with
  no `lowSince` gets one (claimed with a conditional update, so only one alert
  goes out) and people with `stock.manage` are notified. Rising above the
  point clears it, re-arming the alert.
- **Resends**: issue and return accept `X-Client-Op`, so a phone that resends
  after a lost reply issues once.

## Counts

Starting a count snapshots `systemQty` for every active part held in the store
(optionally one group). People enter `countedQty`. Posting applies
`counted − snapshot` to the **current** quantity as COUNT movements, so issues
and receipts made during the count are kept, and sets `countedAt`; uncounted
lines are left alone. A line that would take stock below zero stops the whole
post, naming the part. One open count per store, enforced with a
per-organisation, per-store advisory lock.

## Purchasing

- `POST /stock/reorder` raises one purchase request per low line, for the
  store, with no work order; a part and store with a request already open is
  refused.
- Workflow actions (stock moves only with the module on **and** a catalogue
  part on the request, so older organisations behave as before):
  - *Raise a parts request* (`raiseDemand`, `partField`): the request carries
    the catalogue part, or a free description.
  - *Issue from stock*: takes the quantity out of a store and, for a work
    order's request, records the issue on the work order.
  - *Record receipt* (`storeField`, `qtyField`, `costField`): puts the received
    quantity into the store at the unit cost — given, else the chosen
    quotation's price ÷ requested quantity (a quotation prices the whole
    request), else the average. A request with no work order then closes
    ("Request closed — received into stock").
  - *Record a stock check* notes what is on hand.
- The workflow and the stock movements are saved in one transaction
  (`StoreService.saveWith`).

## Step fields

Fields may be marked `optional` (skipped by the mandatory check, type-checked
when filled); a field an action needs cannot be optional. Two field types:
`part` (searchable catalogue picker) and `store`.

## Import

`POST /stock/import[?dryRun=1]`, a CSV (RFC 4180; a semicolon-separated file
reads decimal commas) of up to 2,000 rows / 1 MB with columns `partNo, name,
unit, group, manufacturer, mfrPartNo, store, bin, qty, unitCost, reorderPoint,
reorderQty`. Stores, units and groups match by key or name. Every row is
checked and every problem listed by spreadsheet row; the import runs in one
transaction and changes nothing unless all rows are good. Opening quantities
(OPENING movements, which set the average cost) are accepted only where that
part has no ledger rows in that store — checked again inside the transaction.

## Labels and reports

`GET /stock/labels?ids=&store=` — A4 sheets (2 × 5) of QR labels opening
`/stock?part=<id>`; with a store, each shows the bin. Narrow screens forward
that link to the phone part screen `/m/part`. Reports: *stock valuation* (per
store, at average cost) and *parts usage* (issues to work orders net of
returns, by part and by work order and asset), as Excel or CSV.

## Not included

Reservations (available = on hand), FIFO, batch, serial or expiry tracking,
several currencies, purchase orders with several lines, issuing while offline,
and parts cost on invoices.

## Tests

`test/e2e/stock.e2e-spec.ts` and `stock-counts.e2e-spec.ts` (fleet demo
organisation) cover the ledger, costing, the race for the last unit, returns,
alerts, purchasing for stock and for work orders, counts with movements during
the count, import, labels, reports and the module switch;
`test/unit/stock.spec.ts`, `csv.spec.ts` and `fields.spec.ts` the pure rules.
`scripts/stock-check.js` drives the screens in a browser.
