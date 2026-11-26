# How the request portal works

The `requests` module lets the people a maintenance team serves report a
problem without an account, follow it, talk to the team and rate the result.
Staff triage what arrives before it becomes a work order. The module is
**on** for new organisations from the general, facilities, fleet, industrial
and medical packs and **off** for aviation organisations and organisations
created before it existed; while it is off every public route answers 404.

Code: `apps/api/src/requests/` — `logic.ts` (tokens, stages, form checks,
email texts; pure), `requests.service.ts` and `public.controller.ts` (the
public side, links, emails, the done hook, reminders), `inbox.service.ts` and
`inbox.controller.ts` (triage, messages, posters), `posters.ts` (PDFs),
`job-hook.ts`. Screens: `apps/web/app/r` (public), `app/(erp)/requests`,
`components/requests/`, `components/m/requester.tsx`.

## Modules and dependencies

`RequestsModule` (data, tokens, emails, the public routes) does not know about
work orders, so `JobsModule` can import it: `JobsService` calls
`JobDoneHook.jobChanged` when a work order reaches a *done* or *closed* phase.
`JobDoneHook` is an abstract class with no imports, so the jobs service does
not load the portal (or its secrets) in unit tests. `RequestsInboxModule`
(triage) imports both. The scheduler runs `remindStale` every 15 minutes.

## Data

| Table | Holds |
|---|---|
| `service_requests` | `REQ-YYYY-NNNN`, status NEW · ACCEPTED · DECLINED · CANCELLED, description, place, site, asset, poster code, category, urgent, requester name / email / phone, language, source (PORTAL · POSTER · STAFF), `trackSalt`, work order, merged, decided by/at, decline reason, spam, rating and comment, reminded / done-notified times, a keyed hash of the sender's address |
| `request_messages` | TEAM or REQUESTER, who, the text, when |
| `request_points` | A poster or sticker: random 8-character code, label, site, asset, active |

Photos are attachments with entity `REQUEST`, named `<request>-photo-…`; on
accept or merge they move to the work order (entity `JOB`). Work orders are
not changed: requests point at them, and one work order can have several.

## Tracking links

`<request id>.<signature>`, the signature an HMAC-SHA256 of
`<organisation>:<request>:<salt>` under a key derived (HKDF) from
`AUTH_SECRET`, truncated to 27 base64url characters (160 bits). Nothing is
stored, so every email carries a fresh copy; changing the salt (spam purge,
erasure) cancels all links. The web page keeps the token in the fragment
(`/r/track#…`) and sends it in POST bodies; a bad token and an unknown
request both answer 404.

## What the requester sees

Their request, the number of photos, a stage derived from the work order's
status phase — received (NEW), accepted (`new`), in progress (`active`),
waiting (`waiting_parts`, `waiting_customer`, `external`), done (`done`,
`closed`), or declined with the reason / cancelled — and the messages, with
the team shown as the organisation. They can message while the request is
new or the work is open, cancel while new, and rate once (1–5, optional
comment) when done.

## Triage

- **Accept** claims the request (conditional update on NEW, so two people
  cannot both act), registers a work order through `JobsService.register`
  (asset, or the place with the request reference as its identifier;
  category; site; type of work), adds a note with the description and
  contact, moves the photos, emails the requester. If registering fails the
  request goes back to NEW.
- **Add to a work order** links to an open work order, notes it and moves the
  photos; if that work is already done, the requester hears at once.
- **Decline** needs a reason the requester sees. **Spam** deletes photos,
  blanks contact details, changes the salt and sends nothing.
- **Erase** (decided requests) blanks name, email and phone and changes the
  salt.
- **Duplicates**: open work orders on the same asset, or linked to requests
  from the same poster, and other new requests from the same asset or poster.

## Notifications and email

| Event | Who |
|---|---|
| New request (urgent ones say so) | `requests.manage` holders |
| Still new after `triageHours` (once) | `requests.manage` holders |
| Requester replies | `requests.manage` holders and the work order's assignee |
| Rating of 1 or 2 | `requests.manage` holders |
| Received, accepted, added to existing work, declined, team message, done | The requester, by email, in their language, when they gave an address and `SMTP_URL` is set |

Emails carry the reference and the tracking link — never the requester's own
words.

## Protections

Rate limits per client address (`PORTAL_RATE_LIMIT` a minute, default 5;
`PORTAL_HOURLY_LIMIT` an hour, default 20; 60 tracking reads a minute), three
requests an hour per email address, 500 waiting requests per organisation,
ten requester messages an hour and fifty in all per request, a hidden trap
field, an access code compared in constant time (a valid active poster code
counts as access), photos checked by content (JPEG, PNG, WebP; 5 MB; three),
length limits on every field, pages kept out of search engines with no
referrer. Set `TRUST_PROXY` behind a reverse proxy so limits see real
addresses.

## Posters

`POST /requests/points` makes a code for a place; `POST /requests/points/assets`
makes (or reuses) one per asset. `GET /requests/points/posters` prints A4
posters (bilingual heading, large QR to `/r?p=CODE`, the place, the
organisation) or a 2 × 5 sticker sheet on the asset label layout. A switched-
off point opens the plain form and cannot be printed.

## Reporting

Dashboard: requests waiting and the average rating over 90 days. Report
`/reports/requests`: each request with source, outcome, work order, hours to
decide, days to complete (from the work order's audit trail) and rating, and
a summary by site and type.

## Not included

Requester accounts, SMS or WhatsApp, CAPTCHA, appointment slots, requester
approval of quotations, custom form fields, a triage inbox in the phone app.

## Tests

`test/unit/requests.spec.ts` (tokens, stages, form checks, emails);
`test/e2e/portal.e2e-spec.ts` (public side, protections, module and portal
off, aviation) and `portal-triage.e2e-spec.ts` (triage, duplicates, spam,
erasure, messages, completion, rating, reminders, dashboard, report, posters)
on the facilities demo organisation. `scripts/portal-check.js` drives it in a
browser, phone and desktop.
