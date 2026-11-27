# Setting up for any maintenance sector

The ERP is not tied to one industry. Each client organisation keeps its own
**vocabulary** (statuses, roles, sites, categories…), **workflow** (steps, who
owns them, what must be entered, what each step does), **permissions**,
**terminology** and **modules**. A *sector pack* is simply a ready-made
starting point for all of that; after set-up, everything can be changed in the
app without code.

## Sector packs

| Pack | For | Work item | Highlights |
|---|---|---|---|
| `general` | Any maintenance team | Work order (`WO-`) | Request → assign → work → parts / approval / contractor → complete → sign-off |
| `facilities` | Buildings, campuses, FM contractors | Work order (`HD-`) | Help desk, trades (HVAC, electrical, plumbing, lifts, fire), term contractors, monthly PPM, root cause on completion |
| `fleet` | Vehicle fleets and workshops | Job card (`JC-`) | Odometer recorded when work starts, service by km or months, vehicle-off-road priority, road test before completion, dealer repairs |
| `industrial` | Factories and process plants | Work order (`MWO-`) | Permit to work and LOTO before work starts, breakdown priority by production impact, run-hour PM, root cause and downtime on completion, OEM / rewind shop repairs |
| `medical` | Hospitals and clinics (biomedical engineering) | Work order (`BME-`) | Decontamination before work, clinical priority, electrical safety test (IEC 62353) before return to service, OEM repairs, annual PPM |
| `aviation` | Approved maintenance organisations (component repair) | Job (`PS-`) | The original CO-RFP-IT-001 configuration: TDI, spares demands with the three-quotation rule, outside-vendor repair with dual customer approvals, AOG/ROA, FOD control, four invoicing streams |

`aviation` stays the default, so existing installations and scripts behave
exactly as before. List the packs on a server with
`node dist/tenants-cli.js packs`.

### Starting an organisation from a pack

```bash
# A new client, with its first administrator
node dist/tenants-cli.js create northfm --name "North FM Services" --host northfm.erp.example.com \
  --pack facilities --admin-email it@northfm.example

# A demonstration organisation with sample users, assets, schedules and work orders
node dist/tenants-cli.js create metrofleet --name "Metro Fleet" --host fleet.demo.example.com --pack fleet --demo
```

For a single-client installation, set `SEED_PACK` before the first seed
(`SEED_PACK=medical node dist/seed-db.js`). Demo organisations from the
general-purpose packs have one user per role — `admin@`, `helpdesk@`,
`supervisor@`, `technician@`, `stores@`, `purchasing@`, `finance@` and
`manager@company.example`, password `demo123` (or `SEED_PASSWORD`).

## Making it the client's own

### Terminology, modules and numbering — *Settings → Your sector* (administrators)

- **Terminology**: what the screens call things — *Job card* or *Work order*,
  *Vehicle* or *Asset*, *Depot* or *Building*, *Emergency call-out* or
  *Priority*.
- **Modules**: switch off what the client does not use — parts & purchasing,
  vendor repairs, priority escalation, invoicing, supplier register, safety
  incidents, tool control, training records, assets, preventive maintenance,
  parts catalogue & stock control, request portal.
  Switched-off modules disappear from the menu and their API answers
  `403 MODULE_OFF`.
- **Numbering**: the work-order prefix (`WO` → `WO-2026-0001`) and where new
  items start.

### Statuses and lists — *Workflow editor → Statuses & lists*

Each workflow (work orders, parts requests, vendor repairs, invoices) has its
own statuses, plus lists for sites, locations, categories, priority levels,
expedite routes, incident types, training courses, types of work and asset
types.

Every status has a **phase** — new, being worked on, waiting for parts,
waiting for the customer, with a vendor, done, or closed. Dashboards, SLA
alerts, record locking, archiving, invoicing eligibility and preventive
maintenance work from phases, so a status can be called anything. A status
marked **final** locks the record. The first status in the list is where new
records start. Entries in use can be made inactive but never deleted.

### Steps and actions — *Workflow editor → each workflow*

A step moves a record from one status to another. For each step you set who
may take it, what they must enter, where the item goes, and which **actions**
it takes:

| Workflow | Actions |
|---|---|
| Work orders | Assign to a person · Raise a parts request · Open a vendor repair · Record a meter reading · Copy fields onto the record |
| Parts requests | Record a stock check · Issue from stock · Evaluate quotations (minimum number, optional bypass approval) · Record receipt (into a store, at a quantity and cost, when the fields are named) |
| Vendor repairs | Set the vendor · Record cost and delivery · Move the item · Close the work order |
| Invoices | Raise the tax invoice · Record payment · Mark outstanding |

Fields are mandatory unless ticked **optional**. A field an action needs must
stay mandatory while the action is on the step; the editor marks such fields
**NEEDED** and refuses to save otherwise.
Removing a step removes its actions with it.

### Field types and proof of work

A field can ask for **text** (the default), a **number**, a **date**, a
**person** (picked from active staff), a **photo**, a **signature**, a
**catalogue part** (searchable, showing what is in stock) or a **store**. The
server checks each type and the audit trail records a readable value — the
person's name, the photo's file name, "signed by …". A photo or signature
field must point to an attachment on the same work order, so the technician
takes it on the spot. New Facilities organisations ask for a photo of the
completed work and the requester's signature when work is completed; the
*Assign to a person* action reads a person field.

### Roles and permissions — *Workflow editor → Roles & permissions* (administrators)

Who owns each step is set on the step. Everything else a role may do is a
permission: register work, assign work to people, raise or close priorities, record quotations,
create invoices, download billing documents, manage the supplier register,
manage incidents, sign tools in and out, manage assets, record meter readings,
run each report, receive escalations, edit the workflow, administer the
organisation. `ADMIN` always holds every permission. People see only the
menus and buttons their permissions allow.

## Assets, meters and preventive maintenance

- **Assets** (`/assets`): tag, name, type, site, location, make, model,
  serial, criticality and status, built into a hierarchy (a building → its
  plant room → a chiller). Each asset shows its open and past work orders.
- **Meters**: odometer, run hours, cycles… A reading may not go backwards
  unless recorded as a reset (replaced instrument). A step can record a
  reading automatically — the fleet pack takes the odometer when work starts.
- **Preventive maintenance** (`/pm`): a schedule raises a work order every
  *N* days and/or every *N* meter units, a set number of days or units before
  it falls due, carrying a checklist and instructions. One work order per
  cycle; when it reaches a *done* status the schedule rolls forward from that
  date and reading. A cycle can be skipped with a reason. A timer checks every
  `PM_INTERVAL_MINUTES` (default 60), and meter readings check straight away.
- **Checklists**: every work order can carry one; preventive ones start from
  the schedule's. Required items must be ticked before the work order can
  reach a *done* status.

## Parts and stock

With the stock module on, each organisation keeps a parts catalogue and the
stock in each of its **stores** (a list, each at a site), with bins and reorder
points. Every change is a line in a ledger. Work orders show the parts used and
their cost; low stock raises an alert and appears on the reorder list, which
raises purchase requests for the store; *Record receipt* puts catalogue parts
into stock; counts correct the quantities. Each general-purpose pack starts
with two stores, part groups for its trade and, in demo organisations, ten
parts with stock, a few of them low. See the [user guide](user-guide.md#parts-and-stock)
and [how stock works](../architecture/stock.md).

## Requests from the people you serve

With the request portal on, the people a team serves report problems
themselves — from a link, or by scanning a *Report a problem* poster in a
building or a sticker on a vehicle, machine or device — and the help desk
turns them into work orders. Each pack's categories become the types of
problem people can choose; its sites, the places they can pick. See the
[user guide](user-guide.md#requests-from-the-portal) and [how the portal
works](../architecture/request-portal.md).

## Currency, look and paperwork

Each organisation keeps its books in its own currency, chosen at setup
(`tenants-cli create … --currency SGD`) or in *Settings* before money is
recorded. Its logo and brand colour go on the screens, the sign-in page, the
phone app, the portal and its PDFs, in a dark or light theme. Organisations
outside aviation get plain documents: a "Tax invoice" (or "Invoice" without
tax), a "Delivery note", a "Work order card", with no form numbers. Quotations, purchases, vendor repairs and invoices can also be in other
currencies, at exchange rates kept by finance; the books stay in the
organisation's own currency ([how it works](../architecture/multi-currency.md)).
See
[the administrator guide](admin-guide.md#9-look-money-labour-and-accounting).

## Labour, reliability and the accounts

The general-purpose packs switch on **labour**: technicians log time on the
desktop or the phone (offline too). It is costed at each person's or role's
hourly rate. Each work order shows its cost so far: parts, purchases, vendor
repairs and labour. Ticking **out of action** when a breakdown is reported
records downtime. That feeds each asset's availability, repair time, time
between failures and preventive compliance, the **reliability report** and
the dashboard. Finance exports invoices, payments and purchases to the
accounting system in once-only batches with the organisation's account
codes. See [how costs and reliability work](../architecture/costs-and-reliability.md).

## Existing aviation installations

Upgrading keeps everything as it was: the migrations convert the old fixed
lists into the organisation's own lists without changing any value, and an
organisation set up before packs existed gets the aviation vocabulary and step
actions filled in the first time it starts. Assets, preventive maintenance,
stock control, the request portal and labour are off for aviation organisations until an administrator
switches them on; the currency stays Ringgit, documents keep their form numbers; aviation's spares-demand workflow is unchanged.
