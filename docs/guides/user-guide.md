# User guide

*Bahasa Melayu: [Panduan pengguna](panduan-pengguna.md).*

This guide is for everyone who uses the ERP day to day. What you can do
depends on your role; buttons for steps your role does not own are not shown.

## Signing in

Open your organisation's ERP address. Sign in with your email and password, or
press **Sign in with …** if your organisation uses single sign-on.

- The first time, you choose your own password (at least 12 characters).
- After 60 minutes without activity you are signed out; sign in again.
- Five wrong passwords lock your account for 15 minutes. An administrator can
  unlock it straight away.
- **EN / BM** at the top switches the language.

## Finding your way

| Screen | What it is for |
|---|---|
| Command | Today's picture: open jobs, SLA breaches, AOG/ROA, revenue |
| JTS Job Register | Every component job, from receipt to return |
| AOG / ROA Priority | Jobs flagged for expedite, and their routes |
| Outside Vendor | Repairs sent to outside vendors |
| Demands & Procurement | Spares demands, RFQs, quotations and POs |
| Suppliers & Vendors | Approved supplier and sub-contractor registers |
| Invoicing & Revenue | Invoices through to payment, with documents |
| FOD & Quality | FOD incidents, tool accountability, training |
| Reports & Exports | Excel/CSV reports (billing, quality and management roles) |

The **bell** at the top shows alerts for records waiting on you: a record about
to miss its SLA, or one that has missed it. Click an alert to open the record.

## Working a record

Every record shows its stage on a rail, its history, and the actions your role
can take now. To move it on:

1. Press the action (for example *Dispatch to workshop*).
2. Fill in the fields it asks for — they are mandatory, often a form number
   such as F219.
3. Submit. The step, your name, the time and what you entered are added to the
   audit trail, which cannot be edited.

A closed job is locked. Jobs closed for over a year move to the archive; tick
**Show archived** on the register to see them.

## Attachments

On a job or an invoice, **Attach file** adds a scanned form, certificate or
photo (PDF, images, Excel, Word, CSV; up to 20 MB). Give the form number if it
has one. Files are kept permanently — if you attach the wrong one, attach the
right one; both stay on record. Every download is checked against the
fingerprint taken at upload.

## On your phone

Open the ERP's address on your phone and sign in: you get the phone app,
starting at **My work**. To keep it like an app, install it — on Android tap
**Install app** (or the browser's menu → *Install*); on iPhone tap **Share**,
then **Add to Home Screen**.

- **My work** lists what is assigned to you, and under **Available** the work
  at your site that your role can take — tap **Pick up** to take it.
- On a work order you can tick the **checklist**, take **photos**, add
  **notes** and record **meter readings**. All four work **without a signal**:
  they are kept on the phone and sent when you are back online. The chip at
  the top says *All sent*, *3 waiting* or *Offline since 10:42*; tap it to send
  now.
- **Next step** (start, complete, request parts…) needs a connection, because
  the server checks the rules. Some steps ask for a photo of the finished work
  or a signature — the customer signs on your screen.
- Point the phone's camera at a **job card** or an **asset label** QR code to
  open it. On an asset, **Report a problem** raises a work order.
- If the server refuses a change (for example the work order was closed
  meanwhile), **More → Sending changes** shows why; retry or discard it.
- Changes are sent while the app is open. Sign out only when *All sent* shows —
  you are warned otherwise; unsent changes stay on the phone for you.
- **More → Open the full site** switches to the desktop screens.
- With stock control on, a work order shows the **Parts used**; *Issue a
  part* and *Return a part* take them from or back to a store. Scanning a
  **shelf or bin label** opens the part: what each store holds and where, what
  is on order, and *Issue to a work order*. Issuing needs a connection, because
  the stock is checked at that moment.

## Parts and stock

*Parts & stock* appears when an administrator switches on stock control.

- **Parts** — the catalogue: part number, name, unit, group, maker, what each
  store holds, the average cost and the value. Click a part for its stores,
  bins and reorder points, its **ledger** (every receipt, issue, return,
  adjustment, transfer and count, with who and why) and its open purchase
  requests. Stores staff can **receive** stock that did not come through a
  purchase (with its cost and where it came from), **adjust** with a reason,
  **transfer** between stores, and set a store's **bin** and **reorder point**.
- **Issuing to work** — on a work order, *Parts used → + Issue part* (or from
  the part, *Issue to work order*). Stock never goes below zero: if two people
  take the last one at the same moment, only one succeeds. *Return* takes back
  no more than was issued to that work order. The work order shows the parts'
  cost, at the average cost when they were issued.
- **Low stock** — when a store falls to its reorder point, people who manage
  stock get an alert (once, until it is restocked), and the dashboard counts
  it. **Reorder** lists everything low with a suggested quantity: change the
  quantities, tick the lines and *Raise purchase requests*. Those requests have
  no work order; they go through quotations and ordering as usual and close
  when the goods are **received into stock**, which also updates the average
  cost.
- **Requests for a work order** — the *Request parts* step lets the technician
  pick a catalogue part (type to search; if one part matches it is chosen) or
  describe one that is not in the catalogue. A catalogue part that is in stock
  can be issued straight from the request.
- **Counts** — *Counts → Start count* for a store (or one group). Type what is
  on each shelf; Enter moves to the next line, and the sheet shows the
  difference and its value as you go. *Post count* applies the differences to
  what the store holds now, so parts issued while you counted are kept. Lines
  left empty are not changed. A store has one open count at a time.
- **Import** — *Import from spreadsheet* loads parts, bins, reorder points and
  opening stock from a CSV file. *Check* lists every row's problems; nothing is
  imported until every row is good. Opening stock is accepted only where that
  part has no history in that store.
- **Labels** — *Print labels* prints QR labels for the parts listed; choose a
  store first to print **bin labels** showing the bin.
- **Reports** — *Stock valuation* (every part held, per store, at average
  cost) and *Parts usage* (parts issued to work orders in a period, net of
  returns, by part and by work order).

## By role

**Stores** — register incoming items (*+ Register job*), dispatch them to the
workshop, record stock checks, issue and receive parts, and print **job
cards**: on a job, *Print job card*; on the register, *Print cards* prints a
card for every job listed. Scanning a card's QR code opens that job. With
stock control on, you also keep the catalogue, receive and count stock, and
raise purchase requests from the reorder list — see *Parts and stock* above.

**Workshop** — record tear-down inspections, raise spares demands, and route
jobs: quotation, BER, SOR or outside vendor.

**MIS** — start work when spares arrive; final inspection and certification.

**MM (management)** — approve demands, record customer indents, declare BER,
close jobs; you also receive alerts for every SLA breach.

**Purchasing** — issue RFQs, record quotations (at least three, or a local
purchase approval), evaluate and raise POs.

**PCE** — run outside-vendor repairs and AOG/ROA priorities.

**Quality** — supplier evaluation, CARs, FOD incidents and the audit trail
export; with administrators, you can change workflows and SLA timers in the
**Workflow editor**.

**Billing and Finance** — open invoices, certify, raise the tax invoice, pass
the correctness gate, submit and record payment. On an invoice, **Documents**
downloads the tax invoice, covering letter, delivery note or the full pack (a
*Certified True Copy* version once a CTC reference is recorded). Reports give
the Sales Performance Report, the e-Payment file and outstanding payments.

**Administrators** — users, settings, single sign-on and the workflow editor;
see the [administrator guide](admin-guide.md).

## When something is not right

- *Cannot reach the server* banner: your connection or the server is down;
  changes are not saved until it clears.
- *Stage owned by …*: that step belongs to another role.
- *Mandatory fields missing*: fill in every field the step asks for.
- *Someone else changed this record first*: reload the page and try again.
- *Only 2 Each of … in Main store*: there is not enough stock in that store —
  choose another store, issue fewer, or receive more first.
