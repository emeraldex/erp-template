# Phone app and offline field work

How the technician phone app (`/m`) works, and what it does and does not do
without a signal. For how people use it, see the user guide ("On your phone").

## Pieces

| Piece | Where | What it does |
|---|---|---|
| Phone screens | `apps/web/app/m/*` | My work, job, asset, asset search, alerts, more. Static, client-rendered pages that read the record id from the query string (`/m/job?id=…`), so one cached page serves every record offline. |
| Field data | `apps/web/lib/offline/field.tsx` | Loads My work and job packs (online → saved; offline → the saved copy), queues changes, runs the sync. |
| Phone storage | `apps/web/lib/offline/db.ts` | IndexedDB, one database per organisation address and person: `kv` (packs, My work, assets) and `outbox` (unsent changes, photos as Blobs). Falls back to memory in private mode. |
| Sync rules | `apps/web/lib/offline/outbox.ts` | Framework-free; unit-tested with `node --test` (`pnpm --filter web test`, also in CI). |
| Service worker | `apps/web/app/sw.js/route.ts` | Generated at build time with a per-build cache name. Caches the `/m` pages, `/login` and the static files they use; never intercepts API calls. `NEXT_PUBLIC_PWA=0` ships a worker that removes itself and its caches. |
| Install | `apps/web/app/manifest.ts`, `app/icons/[size]` | Web app manifest (starts at `/m`) and icons rendered from the company mark. |
| Typed step fields | `apps/api/src/workflow/fields.ts` | Number, date, person, photo and signature fields, checked for all four workflows; the audit trail shows readable values. |
| Field API | `apps/api/src/jobs/*`, `apps/api/src/common/client-ops.ts` | `/jobs/mine`, `/jobs/:id/pack`, notes, assign, claim; the `X-Client-Op` interceptor and offline timestamps (`at`). |

## What works offline

Checklist ticks, notes, photos and meter readings. Each becomes an outbox item
`{ id, jobId, type, payload, createdAt, tries, state }`; the screen shows it
immediately, marked "waiting to send".

Steps (status changes) need a connection: the server checks who may take the
step, mandatory fields, actions and the checklist gate, and another person may
have moved the work order meanwhile. Assigning, picking up work and reporting
a problem are online too.

Packs are kept for everything in *Mine* (refreshed whenever My work loads
online, up to 50) and for jobs opened online in the last 7 days. The
organisation's configuration (statuses, words, lists) is kept in local storage
so the phone keeps the client's words offline.

## Sending

Triggers: the browser comes online, the app regains focus, "Send now", and
every 60 seconds while anything waits.

- Oldest first; one job's changes go in order — if one is held back, that
  job's later changes wait.
- No connection → stop, keep everything. 401 → stop, keep the outbox for the
  same person (they sign in again).
- 409 or 5xx → retry later; a conflict fails after 3 tries. Other 4xx →
  failed, with the server's reason; *More → Sending changes* offers retry or
  discard.
- Every item's id is sent as `X-Client-Op`. The server claims the id before
  applying the change and releases it if the change fails, so a resend after a
  lost answer is not applied twice, and a refused change can be retried. Ids
  are pruned after 30 days by the nightly job.
- Checklist ticks and meter readings carry the time they were made (`at`,
  accepted up to 5 minutes ahead and 30 days back); the audit entry says it
  was recorded offline.

Photos are shrunk on the phone (1600 px long edge, JPEG ≈ 0.8, which also
drops location metadata). At most 200 photos can wait at once.

## Routing

On a narrow screen (< 768 px), `/dashboard`, `/jobs/:id` and `/assets?id=…`
forward to the phone screens unless the person chose *Open the full site*
(remembered on the phone). So printed job cards and asset labels open the
phone view from the phone's camera. The full site also has a menu drawer on
narrow screens.

## Limits

- Sending happens while the app is open; iPhones do not sync in the
  background.
- Needs HTTPS (camera, storage and install require a secure context;
  `localhost` excepted).
- iPhones may clear storage for sites that are not added to the home screen —
  unsent changes would be lost — so installing is recommended.
- Signing out drops cached copies; unsent changes stay for the same person and
  are never shown to anyone else.

## Checking it

`scripts/phone-offline-check.js` drives the whole flow in an emulated phone
against a running facilities demo and checks the server received each change
once, plus a photo-and-signature step. It is run by hand before releases (it
needs a browser and running servers, so it is not part of CI).
