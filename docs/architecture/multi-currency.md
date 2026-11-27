# Transaction currencies and exchange rates

Each organisation keeps its books in one currency, its **base currency**
(see [costs and reliability](costs-and-reliability.md)). A single quotation,
purchase, vendor repair or invoice can be in **another currency**, with an
exchange rate, while the books stay in the base currency.

**Nothing changes until finance enters a rate.** Forms offer the base
currency plus every currency that has a rate in force. With an empty rate
table no currency choice appears, and the API behaves as before. That covers
aviation organisations and every organisation created before this release.

Not covered yet:

- automatic rate feeds;
- revaluing unpaid invoices at period end (unrealised gain or loss);
- supplier payments and their gain or loss (the system does not record
  supplier payments);
- labour rates or stock import costs in a foreign currency;
- three-decimal currencies.

Code: `apps/api/src/fx/` holds three files:

- `fx.ts`: the arithmetic, pure;
- `fx.service.ts`: the rate table and the rule for which rate applies;
- `money-fields.ts`: step fields that carry money.

The users of it are `demands.service.ts`, `ov.service.ts`,
`invoicing.service.ts`, the stock receive route, the documents, the reports
and the accounting export. Screens: `apps/web/lib/fx.tsx` (the money input,
rates hook and dual amounts) and `components/settings/exchange-rates.tsx`.

## 1. The principle

Every money record keeps **three things**: the amount in its own currency,
the exchange rate, and the amount in the base currency.

- The existing `…MYR` fields (`priceMYR`, `costMYR`, `amountMYR`, `gstMYR`,
  `totalMYR`) and stock `unitCost` **are always the base-currency amounts**.
  Job cost, stock value, the dashboard, every report and existing
  integrations work unchanged.
- New fields beside them hold the currency, the rate and the foreign amount.
  They are empty for a base-currency record.
- **Rate direction:** base units for one foreign unit, up to 8 decimals.
  With a Ringgit base, "USD 4.45" means USD 1 = RM 4.45. Screens also show
  the inverse (RM 1 = USD 0.2247), so a rate typed the wrong way round is
  easy to spot.
- **Conversion:** base = foreign × rate, rounded to the base currency's
  decimals.
- **When the rate is fixed:** an estimate uses the rate on the day it is
  recorded. The cost or revenue is **fixed at the rate on the day it becomes
  real**:
  - goods received;
  - a vendor repair closed;
  - a tax invoice raised.

  After that the base amount never changes.

## 2. The rate table

Table `exchange_rates`: currency, effective-from date, rate, entered by,
entered at, with one row per currency and date.

- **The rate in force** on a day is the latest row for that currency dated
  on or before it. A future-dated row waits for its date.
- **Permission:** `fx.manage` ("Keep exchange rates; override the rate on a
  transaction") goes to finance and managers in new organisations, and to
  finance in the aviation pack. Older organisations have it for ADMIN only
  until it is granted.
- **Routes:**
  - `GET /fx/rates` (anyone signed in): each currency's rate in force, its
    date, inverse and age, and its history.
  - `PUT /fx/rates { currency, effectiveFrom?, rate, confirm? }` and
    `DELETE /fx/rates/:id` (`fx.manage`). Deleting a row never changes a
    recorded transaction, because each transaction holds its own copy of the
    rate.
- **Guard:** a rate more than 20% away from the rate it replaces or follows
  is refused with code `RATE_JUMP` unless `confirm: true` is sent. The
  message reads, for example, "USD 1 = RM 0.2247 is 95% below the last rate
  (4.45) — check it was not typed the wrong way round, then confirm". The
  same guard applies to a rate typed on a transaction, and to the rate
  implied by an amount received.
- **No rate:** using a currency with no rate in force is refused with code
  `NO_RATE` and the message "No exchange rate for USD — ask finance to add
  one".
- **Old rates:** forms warn when the rate they will use is more than 30 days
  old. They do not block.
- **Overriding:** only people with `fx.manage` may type a rate on a
  transaction. For everyone else, a sent rate is ignored and the table is
  used.
- **Changing the base currency** empties the table, because its rates were
  quoted against the old currency. `tenants-cli set-currency … --force` is
  refused once any foreign-currency record exists.

## 3. Purchasing

- **Suppliers** can have a usual currency (`partners.currency`, set with
  `PATCH /registers/partners/:id/currency`). It prefills their quotations.
- **Quotations:** `POST /demands/:id/quotations { supplierId, price,
  currency?, rate?, confirm?, eddDays, remarks? }`.
  - The old `{ priceMYR }` still works and means the base currency.
  - The body is validated field by field.
  - The quotation keeps its currency, price and the rate on the day.
    `priceMYR` holds the base equivalent, which is what comparisons rank by.
- **Receipt** fixes the cost at that day's rate.
  - The unit cost in the purchase currency is the one typed at receipt
    (`unitCost` with `unitCostCurrency`), else the chosen quotation's price
    divided by the quantity requested.
  - A typed cost without a currency is in the chosen quotation's currency.
    The screens always send the currency shown.
  - If the table has no rate that day, the quotation's own rate is used.
  - The request records `purchase { currency, rate, amount, amountBase }`.
  - A catalogue part goes into stock at the converted unit cost. **The stock
    ledger stays in the base currency**; the movement also keeps the
    currency, rate and foreign unit cost, for tracing.
- **Job cost, asset cost and the purchases export** use the fixed purchase
  once the goods are received, and the quotation's base price before that.
  Requests received before this release keep their old calculation.
- **Direct receipt into stock:** `POST /stock/receive` takes `currency` (and
  `rate` with `fx.manage`). The cost is converted at today's rate.
- **Vendor repairs:** the cost step takes `<costField>Currency`. The base
  cost is held at that day's rate and fixed (`costFixedAt`) at the rate on
  the day the repair reaches a final status.
- **Money step fields:** steps carry fields as text.
  - A field that feeds a money effect (the `costField` of `recordCost` or
    `recordReceipt`, or the `amountField` of `raiseTaxInvoice`) is marked
    type `money` in `/config`. The stored workflow is not changed.
  - The form sends `<key>`, `<key>Currency` and, with `fx.manage`,
    `<key>Rate` (plus `<key>RateConfirm`).
  - A step sent without `<key>Currency` means the base currency (for a
    receipt, the chosen quotation's currency).

## 4. Sales invoices

An invoice gains `currency`, `fxRate`, and `amount`, `tax` and `total` in
that currency. `amountMYR`, `gstMYR` and `totalMYR` hold the base
equivalents.

- **Draft:** `POST /invoicing { amount, currency, rate?, confirm? }`. The
  old `{ amountMYR }` still means the base currency. The draft uses today's
  rate provisionally.
- **Tax** is worked out in the invoice currency and rounded to its decimals.
- **Raising the tax invoice** applies the rate in force that day (or one
  typed by `fx.manage`) and sets the base amounts. Base net and base tax are
  each converted, and the base total is their sum, so the three always add
  up. From then on nothing changes. An amount typed at that step must be in
  the invoice's currency.
- **Documents:** the tax invoice and covering letter show the invoice
  currency, with the amount in words in that currency. A foreign tax invoice
  also states the rate ("provisional" before the tax invoice is raised) and
  the subtotal, tax and total in the base currency.
- **Payment:** the step that records payment (`markPaid`) records
  `paidRate`, `paidBase` and `fxGain` = `paidBase` − `totalMYR`. The rate
  comes from, in order:
  1. `amountReceived` (what the bank credited, in the base currency);
  2. `paymentRate` (`fx.manage` only);
  3. the rate in force that day.

  A rate more than 20% from the invoice's must be confirmed with
  `paymentRateConfirm: "true"`.

Example with a Ringgit base and 8% SST:

| | USD | Rate | RM |
|---|---|---|---|
| Net | 1,000.00 | 4.45 | 4,450.00 |
| Tax | 80.00 | 4.45 | 356.00 |
| Total | 1,080.00 | | 4,806.00 |
| Paid | 1,080.00 | 4.42 | 4,773.60 |
| Exchange loss | | | −32.40 |

Unpaid invoices show in their own currency and at the base amount from the
invoice rate. They are not revalued.

## 5. Reports and the accounting export

Existing columns keep their meaning and position, so current import
mappings still work. New columns are added at the end. Base-currency rows
carry the base currency and a rate of 1.

- **Sales performance:** invoice currency, exchange rate, total in the
  invoice currency, exchange gain or loss.
- **Outstanding payments:** invoice currency, exchange rate, total in the
  invoice currency.
- **Accounting export:**
  - *Sales:* invoice currency, exchange rate, and net, tax and total in the
    invoice currency.
  - *Receipts:* the existing *Amount* stays the base total, which clears the
    receivable. New columns: invoice currency, amount in the invoice
    currency, payment rate, amount received, exchange gain or loss, and the
    gain/loss account.
  - *Purchases:* purchase currency, exchange rate, amount in the purchase
    currency.
- **New account code:** `fxGainLoss` (default 7900) in the accounting
  settings.

## 6. Data (one additive migration, `20261202000000_fx`)

| Table | New |
|---|---|
| `exchange_rates` | new table (section 2) |
| `partners` | `currency` |
| `quotations` | `currency`, `price`, `fxRate` |
| `demands` | `purchaseCurrency`, `purchaseRate`, `purchaseAmount`, `purchaseAmountBase` |
| `stock_movements` | `currency`, `fxRate`, `unitCostFx` |
| `ov_repairs` | `currency`, `cost`, `fxRate`, `costFixedAt` |
| `invoices` | `currency`, `fxRate`, `amount`, `tax`, `total`, `paidRate`, `paidBase`, `fxGain` |

Rates are `Decimal(18,8)`. Empty currency fields mean the base currency.

## 7. Tests and checks

- **Unit:** `fx.spec.ts` covers conversion and rounding for 0- and 2-decimal
  currencies, the rate in force by date, the jump measure, rate parsing, and
  invoice amounts that add up.
- **Integration:** `fx.e2e-spec.ts` covers:
  - the rate table: permissions, dated lookup, the guard (including
    re-entering a day's rate), and delete;
  - quotations in three currencies, the old body, and rates ignored without
    `fx.manage`;
  - receipt fixing into stock and for a direct purchase in the job cost;
  - direct receipt;
  - a vendor repair fixed at closure (aviation);
  - a US-dollar invoice: provisional rate, rate fixed at the tax invoice,
    PDF, payment by amount received and by today's rate, gain and loss;
  - the export and report columns;
  - the `set-currency` guard.
- **Browser:** `scripts/fx-check.js` runs 15 checks against a fresh
  facilities demo:
  1. Finance adds rates; a wrong-way rate is questioned.
  2. Purchasing records quotations in US and Singapore dollars.
  3. Stores receive after the rate moves.
  4. Finance raises a US-dollar invoice, checks the PDF, and records a
     payment with an exchange loss.
  5. The accounting batch shows the currencies and the loss.
