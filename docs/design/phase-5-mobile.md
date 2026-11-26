# Phase 5 — Technician mobile app: design and build plan

Status: design agreed, not yet built. This file is the brief for the build;
when the phase is done, replace it with `docs/architecture/mobile-offline.md`
describing what was built.

## Decisions (owner's choices)

1. **Field work offline.** With no signal a technician can open their work,
   tick checklists, add notes, take photos and record meter readings; these
   sync later. Status changes need a connection.
2. **Assignment to a named person.** "My work" = assigned to me, plus
   unassigned work at my site that my role can pick up.
3. **Proof of work.** A workflow step can require a photo or a signature drawn
   on the phone.

Not in this phase: phone push notifications, in-app QR scanner (the phone's
own camera opens the links), time on the job, offline status changes,
optional (non-mandatory) step fields, app-store apps, signatures on printed
documents.

Aviation organisations must behave exactly as before. Every existing test and
`scripts/section8-demo.py` must pass unchanged, except tests that this plan
names.

## 1. Data model — one additive migration (`…_mobile`)

- `jobs`: `assigneeId TEXT NULL`, `assigneeName TEXT NULL`, `assignedAt
  TIMESTAMP NULL`; index on `assigneeId`. No foreign key: users are never
  deleted, and the name is kept for the record.
- `attachments`: `kind TEXT NOT NULL DEFAULT 'file'` (`file` | `photo` |
  `signature`), `caption TEXT NULL`, `signedBy TEXT NULL`.
- `client_ops`: `id TEXT PRIMARY KEY` (the phone's operation id), `userId`,
  `path`, `createdAt`. Used to apply a replayed offline change once.

Check the generated SQL contains no `DROP` and no column rewrite.

## 2. Assignment

- New permission `jobs.assign` — "Assign work orders to people". Packs:
  HELPDESK, SUPERVISOR and MANAGER in the maintenance packs; MM and PCE in
  aviation (unused unless they start assigning). Existing organisations: their
  administrator grants it in *Roles & permissions* (ADMIN already has it) —
  say so in the upgrade notes; do not backfill silently.
- `PATCH /jobs/:id/assignee` `{ userId | null }` — needs `jobs.assign`; the
  user must be active; refused on final or archived jobs. Audit: "Assigned to
  X" / "Unassigned".
- `POST /jobs/:id/claim` — self-assign an **unassigned** job when the caller's
  role owns at least one step from its current status (or holds
  `jobs.assign`). 409 if someone got there first.
- Step action `assignTo { field }` (JOB workflow; `field` is NEEDED) sets the
  assignee from a `user`-type field (§3). Maintenance packs' *Assign* step
  uses it: `assignee` becomes a user picker. Aviation is untouched.
- `GET /users/directory` — any signed-in user: `id, name, role, branch` of
  active users. No e-mail addresses.
- On assignment (any route), an in-app notification to the assignee
  (`kind: job.assigned`, `ref: JOB:<id>`) unless they assigned it to
  themselves.
- Desktop: an assignee column and a "Mine" filter on the job register, and an
  assignee control on the job page (shown when any job has an assignee or the
  pack is not aviation, so aviation screens do not change).

## 3. Typed step fields and proof of work

A mandatory field gains an optional `type`:
`text` (default) · `number` · `date` · `user` · `photo` · `signature`.

Server (one resolver, run by all four workflow services before
`applyTransition`):

| Type | Value sent | Check | Audit shows |
|---|---|---|---|
| text | string | non-empty (as today) | the value |
| number | string | finite number | the value |
| date | `YYYY-MM-DD` | real date | the value |
| user | user id | active user in this organisation | the person's name |
| photo | attachment id | exists, on **this** record, an image | "photo ‹filename›" |
| signature | attachment id | exists, on this record, `kind = signature`, has `signedBy` | "signed by ‹name›" |

Actions receive the raw value (e.g. the user id); the audit trail gets the
readable one. Existing untyped fields behave exactly as now.

- Upload: `POST /attachments/:entity/:id` accepts `kind`, `caption`,
  `signedBy` form fields. `signature` must be a PNG under 200 KB with
  `signedBy` (2–80 characters). Signatures and photos follow the existing
  rules: checksum kept, never deletable, refused on final records.
- Workflow validator and editor: a type selector per field; unknown types are
  refused. `assignTo.field` must be a `user` field; `recordMeter.field` should
  be a `number` field (warning, not an error, so existing set-ups still save).
- Web: one shared `StepForm` component renders typed fields for all four
  workflows on desktop and phone — numeric keypad, date picker, user picker
  from the directory, camera/file capture, signature pad (canvas, "Clear",
  name of the person signing).
- Packs (new organisations only; existing ones keep their configuration):
  - facilities — *Complete work* adds `photoAfter` (photo, "Photo of the
    completed work") and `requesterSignature` (signature, "Requester
    sign-off").
  - fleet — `odometer` becomes `number`.
  - industrial — `downtimeHours` becomes `number`.
  - all maintenance packs — `assignee` (user) + `assignTo`; `qty` number.
  - aviation, medical, general: no proof fields added.

## 4. Field API

- `GET /jobs/mine` → `{ mine: Item[], available: Item[] }`. *mine*: assigned
  to me, not final. *available*: unassigned, not final, at my site, and my
  role owns a step from the current status. `Item`: id, component, serial,
  status, statusSince, site, location, jobType, assignee, open priority type,
  asset `{ id, tag }`, checklist `{ done, total }`, SLA `{ days, overdueBy }`
  when a timer applies. Order: open priority, then most overdue, then oldest.
  Declare before `/jobs/:id` (route order).
- `GET /jobs/:id/pack` → everything the phone needs for one job in one call:
  the job, its asset (brief + meters), PM instructions, attachment metadata,
  and the steps the caller may take now (with typed fields).
- `POST /jobs/:id/notes` `{ text }` (1–1000 chars) → audit entry "Note: …".
  Any signed-in user; refused on final or archived jobs.
- Offline replay safety: `X-Client-Op: <uuid>` on notes, attachment uploads
  and meter readings. First use is recorded in `client_ops`; a repeat returns
  `200 { duplicate: true }` without applying again. A failed request does not
  consume the id. Rows older than 30 days are pruned by the nightly job.
- Offline timestamps: checklist ticks and meter readings accept an optional
  `at` (not in the future beyond 5 minutes, not older than 30 days); the audit
  entry notes when it was recorded and when it arrived. Meter readings keep
  the only-goes-up rule; a refused reading comes back as a failed item on the
  phone.
- `GET /assets/labels?ids=…` → A4 PDF, 2 × 5 labels per page: QR code, tag,
  name, site. The QR encodes `<web>/assets?id=<id>` (same base-URL logic as
  job cards). "Print labels" on the asset register for the current filter
  (up to 100).

## 5. Phone screens (`/m/…`)

All `/m` routes are **static, client-rendered pages with query parameters**
(`/m/job?id=…`, not `/m/job/[id]`), so one cached page serves every record
offline.

- `/m` — **My work**: *Mine* / *Available* tabs, cards with large touch
  targets, refresh, and a sync chip: "All sent" · "3 waiting" · "Offline since
  10:42".
- `/m/job?id=` — header (number, item, status, priority), asset and meters
  (record a reading), instructions, checklist (large tick boxes, note per
  item), photos (take or choose, caption, thumbnails), notes with the
  timeline, next steps (shared `StepForm`; disabled offline with "needs a
  connection"), *Pick up* for unassigned work.
- `/m/asset?id=` — summary, meters, open work orders, next preventive
  maintenance, history, and *Report a problem* (registers a work order against
  the asset; needs `jobs.register`; online only).
- `/m/alerts` — the existing notifications.
- `/m/more` — language, sync details and items needing attention, offline
  data size and "Remove offline data", how to install, full site, sign out.
- Bottom tab bar: My work · Assets · Alerts · More.

Routing: after sign-in on a narrow screen go to `/m` (desktop keeps
`/dashboard`); "Full site" in *More* is remembered. `/jobs/[id]` and
`/assets?id=` on a narrow screen forward to the `/m` equivalents unless "Full
site" is on — so job cards already printed, and the new asset labels, open the
phone view from the phone's camera.

Also fix: below the `md` breakpoint the full site has **no navigation at all**
(the sidebar is hidden). Add a menu button and drawer with the same,
permission-filtered navigation.

Design: reuse the colour tokens; body text ≥ 16 px and touch targets ≥ 44 px on
`/m`; no 10 px mono labels there. All `/m` strings in English and Bahasa
Melayu. Wording follows the organisation's terms (`useVocab`).

## 6. Installable app and offline

- `app/manifest.ts` (standalone display, theme colours, 192/512 and maskable
  icons rendered from the existing mark) and an install hint in *More* (Android
  prompt; iPhone "Share → Add to Home Screen").
- `public/sw.js`, hand-written, no new dependency:
  - cache-first for `/_next/static/*`; network-first with cached fallback for
    `/m…` page loads; precache the `/m` pages on install;
  - **never** caches or intercepts API calls;
  - versioned cache name; old caches removed on activate; "Update available —
    reload" prompt instead of silent takeover;
  - registered only in production builds; `NEXT_PUBLIC_PWA=0` builds ship a
    `sw.js` that unregisters itself (kill switch).
- The Dockerfile must now copy `apps/web/public` into the image (there was no
  `public/` before).
- Offline data lives in IndexedDB, managed by the app (not the service
  worker), keyed by organisation + user:
  - `packs` — job packs for everything in *Mine* (refreshed whenever My work
    loads online, up to 50) and any job opened online in the last 7 days;
  - `mine`, `config`, recent assets;
  - `outbox` — queued changes: `{ id (uuid), jobId, type: checklist | note |
    photo | meter, payload (photo blobs included), createdAt, tries, lastError,
    state: pending | failed }`.
- Sync: when the browser comes online, when the app regains focus, on "Sync
  now", and every 60 s while anything is pending. One job's changes go in
  order. 409 → retry (up to 3). 4xx → mark **failed** with the server's reason;
  the technician can retry or discard (with confirmation). 401 → sign in again;
  the outbox is kept and resumes for the same user.
- The screen updates immediately with a "waiting to send" mark; after sync the
  pack is fetched again.
- Photos are resized on the phone to 1600 px on the long edge, JPEG ≈ 0.8,
  which also strips location data. Outbox limit: 200 photos.
- Sign-out with unsent changes warns first; unsent changes stay on the phone
  for their owner and are never shown to another user. Signing out removes
  cached packs.
- Keep the queue/sync rules in a framework-free module
  (`lib/offline/outbox.ts`) with unit tests (Node's built-in test runner on
  Node 24; add a `web` test step to CI).

Known limits to document: syncing happens while the app is open (iPhones do
not sync in the background); the app and camera need HTTPS (localhost
excepted); an iPhone can clear data for sites not added to the home screen, so
installing is recommended.

## 7. Tests

API unit: typed-field resolver (each type, good and bad); `assignTo`;
validator accepts types and refuses unknown ones; every pack still valid and
`jobs.assign` known.

API e2e (fleet organisation; update the existing fleet tests to send a user id
for `assignee`): assign through the step → appears in the technician's
`/jobs/mine`; claim and its race; reassign refused without `jobs.assign`;
notification created; directory hides e-mails and deactivated users; a
facilities-style photo step refuses no attachment / another job's attachment /
a non-image and accepts a real one; signature needs `signedBy`; number and
date validation; the same `X-Client-Op` twice makes one note, one photo, one
reading; `at` bounds; `/jobs/:id/pack` shape; labels PDF lists the tags.

Web: outbox unit tests (ordering, retry, failure, discard, per-user
separation); typecheck and build.

Browser run (Playwright, phone emulation — run locally during the build, with
screenshots for review; not in CI): manifest and service worker register; load
My work online → go offline → open a job from cache → tick a checklist item,
add a note, attach a photo → "waiting" shown → back online → sent, and the
server has them; a photo + signature step on the facilities pack; the desktop
aviation job page unchanged.

Regression: all existing unit and e2e tests and the Section 8 script.

## 8. Build order

1. Migration; assignment API, permission, directory, notification; tests.
2. Typed fields, photo/signature attachments, validator and editor, pack
   updates; tests.
3. Field API: `/jobs/mine`, pack, notes, replay safety, timestamps; tests.
4. Asset labels PDF.
5. Web: shared `StepForm`; assignee on desktop; drawer navigation for the full
   site on narrow screens.
6. Web: manifest, icons, service worker, `/m` screens online.
7. Web: offline store, outbox, sync UI; outbox tests; CI step.
8. Phone-emulation run and screenshots; docs (user guide + panduan pengguna
   "On your phone", admin guide HTTPS/install notes, sectors guide field types
   and `jobs.assign`, security overview "data on the device", API guide);
   replace this file with the architecture note; CI green; push. Ask before
   opening a pull request.

Stop and hand back to design (Fable) if any of these come up: offline status
changes turn out to be needed for a step to make sense; the service worker
cannot be made reliable with the standalone build; the typed-field resolver
would change any aviation behaviour.
