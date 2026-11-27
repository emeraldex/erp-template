# Phase 9 design: transaction currencies and exchange rates

Phase 8 gave each organisation one currency for its books (the **base
currency**). Phase 9 lets a single quotation, purchase, vendor repair or
invoice be in **another currency**, with an exchange rate, while the books
stay in the base currency.

## Decisions (from the product owner)

1. **Where:** purchasing (quotations, orders, receipts into stock, vendor
   repairs) and sales invoices.
2. **Rates:** a rate table kept by finance. Each transaction copies the rate
   in force; finance can override it on that transaction. No outside rate
   service.
3. **Exchange gain or loss on payment:** recorded when a foreign-currency
   invoice is paid, and exported to accounting.
4. **Nothing else** is added to this phase.

Not in this phase:

- automatic rate feeds;
- revaluing unpaid invoices at period end (unrealised gain or loss);
- supplier payments and their gain or loss (the system does not record
  supplier payments);
- labour rates or stock import costs in a foreign currency;
- three-decimal currencies, credit notes, invoice lines, e-Invoicing.

## 1. The principle

Every money record keeps **three things**: the amount in its own currency,
the exchange rate, and the amount in the base currency.

- The existing `…MYR` fields (`priceMYR`, `costMYR`, `amountMYR`, `gstMYR`,
  `totalMYR`) and stock `unitCost` **stay the base-currency amounts**. Job
  cost, stock value, the dashboard, every report and every existing
  integration keep working without change.
- New fields beside them hold the currency, the rate and the foreign amount.
  They are empty for a base-currency record.
- **Rate direction:** base units for one foreign unit, up to 8 decimals.
  With a Ringgit base, "USD 4.45" means USD 1 = RM 4.45. Screens also show
  the inverse ("RM 1 = USD 0.2247") so a rate typed the wrong way round is
  easy to spot.
- **Conversion:** base = foreign × rate, rounded to the base currency's
  decimals.
- **When the rate is fixed:** an estimate uses the rate on the day it is
  recorded. The cost or revenue is **fixed at the rate on the day it becomes
  real**: goods received, a vendor repair closed, a tax invoice raised.
  After that the base amount never changes.

**Nothing changes until finance enters a rate.** The currencies offered on a
form are the base currency plus every currency that has a rate. With an
empty rate table no currency choice appears, and the API behaves as it does
today. That covers aviation organisations and every existing organisation.

## 2. The rate table

- Table `exchange_rates`: currency, effective-from date, rate, entered by,
  entered at. One row per currency and date.
- **The rate in force** on a day is the latest row for that currency dated
  on or before that day. A future-dated row takes effect on its date.
- New permission **`fx.manage`** ("Keep exchange rates; override the rate on
  a transaction"): finance and managers in new organisations; finance in
  the aviation pack. Older organisations have it for ADMIN only until
  granted.
- Routes:
  - `GET /fx/rates`: the latest rate per currency and its history. Any
    signed-in user, because forms need it to show the conversion.
  - `PUT /fx/rates { currency, effectiveFrom, rate }` (`fx.manage`).
  - `DELETE /fx/rates/:id` (`fx.manage`). Deleting a row never changes a
    recorded transaction, because each transaction holds its own copy.
- **Guard against a wrong rate:** a rate more than 20% away from the
  previous rate for that currency is refused unless the request says
  `confirm: true`. The screen asks "USD 1 = RM 0.22 is 95% below the last
  rate. Is this right?". The same guard applies to a rate typed on a
  transaction.
- **No rate, no transaction:** using a currency with no rate in force is
  refused with "No exchange rate for USD — ask finance to add one".
- **Old rates:** a form shows the date of the rate it will use, and warns
  when that rate is more than 30 days old. It does not block.
- **Overriding:** only people with `fx.manage` may type a rate on a
  transaction. For everyone else the server looks the rate up and ignores
  any rate sent.

## 3. Purchasing

**Suppliers.** A supplier or contractor can have a default currency
(`partners.currency`). It prefills the currency of a quotation from them.

**Quotations.** A quotation gains a currency, a price in that currency and
the rate on the day it is recorded. `priceMYR` holds the base equivalent.

- `POST /demands/:id/quotations` accepts `{ price, currency }`. The old
  `{ priceMYR }` still works and means the base currency.
- The comparison of quotations shows each price in its own currency and in
  the base currency, and ranks by the base amount.
- The audit line reads "Quotation received — Northstar (USD 2,400.00 =
  RM 10,680.00 at 4.45)".

**Receipt.** When the goods are received, the cost is fixed at that day's
rate.

- The unit cost in the quotation's currency is the quotation price divided
  by the quantity requested, as today, or the unit cost typed at receipt. A
  typed cost is in the chosen quotation's currency unless another is chosen.
- The request records the currency, the rate used, the foreign amount and
  the base amount.
- A catalogue part goes into stock at the base unit cost. **The stock ledger
  stays in the base currency only.** The movement also notes the currency,
  rate and foreign unit cost, for tracing.
- If the rate table has no rate on the receipt day, the quotation's own rate
  is used.

**Job cost and the purchases export** use the fixed receipt amount once the
goods are received. Before that they use the quotation's base price, as
today. Requests received before this release keep today's calculation.

**Direct receipt into stock** (`POST /stock/receive`) accepts a currency
with the unit cost, converted at today's rate.

**Vendor repairs.** The cost step takes a currency. `costMYR` holds the base
equivalent at that day's rate. When the repair reaches a final status, the
base cost is fixed at that day's rate.

**Money fields on workflow steps.** Steps carry their fields as text, so a
money amount needs a convention:

- A step field that feeds a money effect (the `costField` or `amountField`
  of an effect on that step) is a **money field**. `/config` marks it with
  type `money`, whatever type the workflow stores. No stored workflow needs
  migrating.
- The form shows the amount, a currency choice, and the rate that will
  apply. It sends `<key>`, `<key>Currency` and, with `fx.manage`,
  `<key>Rate`.
- A step sent without `<key>Currency` means the base currency, as today.

## 4. Sales invoices

An invoice gains a currency, the rate, and the net, tax and total in that
currency. `amountMYR`, `gstMYR` and `totalMYR` hold the base equivalents.

- **Draft:** `POST /invoicing { amount, currency }`. The old `{ amountMYR }`
  still works and means the base currency. The draft uses the day's rate
  provisionally.
- **Tax:** worked out in the invoice currency and rounded to that
  currency's decimals.
- **Tax invoice raised:** the rate in force that day replaces the
  provisional rate, and the base amounts are set: base net and base tax are
  each converted and rounded, and the base total is their sum, so the three
  always add up. From then on the currency, the rate and the amounts cannot
  change.
- **Documents:** the tax invoice, covering letter and delivery note show
  amounts in the invoice currency, with the amount in words in that
  currency. A foreign-currency tax invoice also prints the exchange rate
  and the net, tax and total in the base currency. Malaysian tax invoices
  in a foreign currency must show these.

**Payment and the exchange difference.** Recording a payment on a
foreign-currency invoice captures what was actually received in the base
currency:

- the payment step gains two optional fields: the amount received in the
  base currency (what the bank credited), or the rate;
- with neither, the rate in force on the payment day is used;
- the invoice records the payment rate, the base amount received, and the
  **exchange gain or loss** = base amount received − base total of the
  invoice.

Example with a Ringgit base and 8% tax:

| | USD | Rate | RM |
|---|---|---|---|
| Net | 1,000.00 | 4.4500 | 4,450.00 |
| Tax | 80.00 | 4.4500 | 356.00 |
| Total | 1,080.00 | | 4,806.00 |
| Paid | 1,080.00 | 4.4200 | 4,773.60 |
| Exchange loss | | | −32.40 |

Outstanding invoices are shown in their own currency and at the base amount
from the invoice rate. They are not revalued while unpaid.

## 5. Reports, dashboard and the accounting export

- **Dashboard and totals:** base amounts, unchanged.
- **Sales performance and outstanding payments:** the existing columns stay
  base amounts. New columns at the end give the invoice currency, the rate
  and the total in that currency.
- **Accounting export.** Existing columns keep their meaning and position,
  so current import mappings still work. New columns are added at the end:
  - *Sales:* invoice currency, exchange rate, and net, tax and total in the
    invoice currency.
  - *Receipts:* invoice currency, amount in the invoice currency, payment
    rate, amount received (base), exchange gain or loss, and the gain/loss
    account. The existing *Amount* stays the base total of the invoice,
    which is what clears the receivable.
  - *Purchases:* purchase currency, exchange rate, and amount in the
    purchase currency.
- New account code **exchange gain or loss** (`fxGainLoss`, default 7900)
  in the accounting settings.

## 6. Changing the base currency

The base currency is already locked once money is recorded. Two additions:

- `tenants-cli set-currency … --force` is **refused** once any
  foreign-currency transaction exists. Relabelling would make its rate and
  base amount wrong.
- When `--force` is allowed, it empties the rate table, because the rates
  were quoted against the old base currency.

## 7. Data changes (all additive)

| Table | New |
|---|---|
| `exchange_rates` | new table (section 2) |
| `partners` | `currency` |
| `quotations` | `currency`, `price`, `fxRate` |
| `demands` | `purchaseCurrency`, `purchaseRate`, `purchaseAmount`, `purchaseAmountBase` (set at receipt) |
| `stock_movements` | `currency`, `fxRate`, `unitCostFx` (receipts only) |
| `ov_repairs` | `currency`, `cost`, `fxRate`, `costFixedAt` |
| `invoices` | `currency`, `fxRate`, `amount`, `tax`, `total`, `paidRate`, `paidBase`, `fxGain` |

Rates are `Decimal(18,8)`. Foreign amounts use the same precision as the
base amounts beside them. Empty currency fields mean the base currency.

## 8. Screens

- **Settings → Exchange rates** (`fx.manage`): each currency's latest rate,
  its date and inverse, a form to add a rate, and the history.
- **Quotations:** currency and price on the form; both currencies in the
  comparison.
- **Step forms:** the money field (amount, currency, rate) for vendor
  repair cost, receipt unit cost and invoice amount.
- **Stock → Receive:** currency beside the unit cost.
- **Suppliers:** default currency.
- **Invoices:** currency when drafting; the invoice page shows both
  currencies and the rate; the payment step takes the amount received or
  the rate; a paid invoice shows its gain or loss.
- **Accounting export:** the gain/loss account code.
- The phone app records no money, so it is unchanged.

## 9. Tests

- **Unit:** conversion and rounding for 0- and 2-decimal currencies in both
  directions; the rate in force by date; the 20% guard; invoice net, tax
  and total adding up after conversion; gain and loss.
- **Integration:**
  - the rate table: permissions, dated lookup, guard, delete keeps history;
  - quotations in several currencies ranked in the base currency; the old
    `priceMYR` body still works;
  - receipt fixes the cost at the receipt-day rate and feeds stock average
    cost, job cost and the purchases export; direct receipt in a foreign
    currency;
  - vendor repair cost fixed at closure;
  - a foreign invoice: provisional rate, rate fixed at the tax invoice, PDF
    wording, locked afterwards, payment by amount received and by rate,
    gain and loss, export columns;
  - no rates: every form and response as before; aviation untouched;
    `scripts/section8-demo.py` unchanged;
  - `set-currency --force` refused with foreign transactions.
- **Browser** (`scripts/fx-check.js`) against a fresh facilities demo:
  1. Finance adds USD and SGD rates; a wrong-way rate is questioned.
  2. Purchasing records quotations in three currencies and orders the
     cheapest in base terms.
  3. Stores receive the goods after the rate has moved; the stock value and
     job cost follow the receipt-day rate.
  4. Finance raises a USD invoice, checks the PDF, records a payment at a
     different rate and sees the loss.
  5. The accounting batch shows the currencies, rates and the loss.

## 10. Build order

1. The rate table: conversion library, lookup, guard, permission, routes.
2. Purchasing: supplier currency, quotations, money step fields, receipt
   fixing, direct receipt, vendor repairs; job cost and purchases export.
3. Invoices: draft, tax invoice, documents, payment and gain or loss.
4. Reports and accounting export columns; the `set-currency` guard.
5. Screens.
6. Browser check, documentation (this document becomes
   `docs/architecture/multi-currency.md`, with guide updates), CI checks,
   push.
