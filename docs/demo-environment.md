# Running a sales demo

A demo should show a prospect *their* kind of work in their kind of
organisation, without them seeing anyone else's.

## Set up once

Production stack with the proxy (see the admin guide), then create one
organisation per prospect with sample data:

```bash
docker compose exec api node dist/tenants-cli.js create apex --name "Apex Aero Services" --host apex.demo.example.com --demo
# …or in the prospect's own sector:
docker compose exec api node dist/tenants-cli.js create metro --name "Metro Fleet" --host metro.demo.example.com --pack fleet --demo
```

The aviation demo dataset has ten users, one per role (password `demo123`, or
`SEED_PASSWORD`), and jobs, demands, outside-vendor repairs, invoices and
suppliers at every stage. The other packs' demos have a user per role
(`admin@`, `helpdesk@`, `supervisor@`, `technician@`, `manager@company.example`…),
six assets with meters and preventive schedules, and work orders across the
workflow — the first preventive work order appears within the hour. Set the prospect's company name in Settings, and the
tax rate their contracts use.

For a laptop with no server at all, build the web app with
`NEXT_PUBLIC_DEMO_MODE=1`: it shows bundled sample data when no API is running.
Changes are not saved in that mode.

## A 20-minute script

1. **Command dashboard** (aisyah, ADMIN) — open jobs, SLA breaches citing their
   procedure clause, AOG/ROA board, revenue.
2. **A job end to end** — Stores registers an item and prints its job card;
   scan the QR code with a phone to open it. Workshop records the TDI and
   raises a spares demand. Show that a Workshop user cannot take a Stores step,
   and that mandatory form numbers are enforced.
3. **Procurement** — the minimum-three-quotations rule, then a local purchase.
4. **Outside vendor and AOG** — raise an ROA, show the route and EDD on the job
   card.
5. **Invoicing** — certify, raise the tax invoice, download the document pack
   and a Certified True Copy; the correctness gate.
6. **Reports** — Sales Performance Report and the audit trail in Excel.
7. **Workflow editor** (qistina, QUALITY) — give another role a step, add a
   mandatory field, change an SLA timer; show the change log.
8. **Their organisation** — single sign-on with their identity provider,
   their tax and company details, and that their data is a separate schema.

`scripts/section8-demo.py` runs the RFP's Section 8 scenario against a
running API in under a minute — useful to show the requirements are met.

## Resetting

Take the prospect's organisation down and create it again. Open `psql`:

```bash
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

and run:

```sql
DROP SCHEMA t_apex CASCADE;
DELETE FROM erp_control.tenants WHERE id = 'apex';
```

Then create it again:

```bash
docker compose exec api node dist/tenants-cli.js create apex --name "Apex Aero Services" --host apex.demo.example.com --demo
```
