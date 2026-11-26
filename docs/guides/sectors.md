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
  incidents, tool control, training records, assets, preventive maintenance.
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
| Work orders | Raise a parts request · Open a vendor repair · Record a meter reading · Copy fields onto the record |
| Parts requests | Record a stock check · Issue from stock · Evaluate quotations (minimum number, optional bypass approval) · Record receipt |
| Vendor repairs | Set the vendor · Record cost and delivery · Move the item · Close the work order |
| Invoices | Raise the tax invoice · Record payment · Mark outstanding |

A field an action reads must stay mandatory while the action is on the step;
the editor marks such fields **NEEDED** and refuses to save otherwise.
Removing a step removes its actions with it.

### Roles and permissions — *Workflow editor → Roles & permissions* (administrators)

Who owns each step is set on the step. Everything else a role may do is a
permission: register work, raise or close priorities, record quotations,
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

## Existing aviation installations

Upgrading keeps everything as it was: the migrations convert the old fixed
lists into the organisation's own lists without changing any value, and an
organisation set up before packs existed gets the aviation vocabulary and step
actions filled in the first time it starts. Assets and preventive maintenance
are off for aviation organisations until an administrator switches them on.
