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

## By role

**Stores** — register incoming items (*+ Register job*), dispatch them to the
workshop, record stock checks, issue and receive parts, and print **job
cards**: on a job, *Print job card*; on the register, *Print cards* prints a
card for every job listed. Scanning a card's QR code opens that job.

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
