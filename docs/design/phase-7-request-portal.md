# Phase 7 design: request portal

Lets the people a maintenance team serves — tenants, drivers, operators, ward
staff — report a problem without an account, follow it, talk to the team and
rate the result. Staff triage what arrives before it becomes a work order.

## Decisions (from the product owner)

1. **Anyone with the link** can send a request; no account. Abuse is limited
   by rate limits, a hidden trap field and an optional access code.
2. **Inbox first**: requests are triaged — accepted into a new work order,
   added to an existing one, or declined with a reason.
3. **Tracking link and email**: a private tracking page, plus emails when
   mail is configured.
4. **Extras, all in**: photos on a request, a rating when done, QR posters for
   places and assets, two-way messages.

Not in this phase: requester accounts, SMS or WhatsApp, CAPTCHA, appointment
slots, requester approval of quotations, custom form fields, a staff inbox in
the phone app.

Aviation organisations and every existing organisation behave exactly as
before: the `requests` module is **off** for them, and while it is off every
public route answers 404.

## 1. Module, permission, settings

- Module `requests`. On for new organisations from the general, facilities,
  fleet, industrial and medical packs; off for aviation and existing ones.
- Permission `requests.manage` — triage, messages, posters, erasing contact
  details. Packs: HELPDESK, SUPERVISOR, MANAGER. Signed-in staff can see a
  work order's requesters.
- Settings block `portal` (`PATCH /settings/portal`, `org.admin`):
  `open` (the public form accepts requests; default true), `accessCode`
  (empty = none), `intro` / `introMs` (shown above the form, ≤ 500
  characters), `askCategory` (default true), `triageHours` (default 4; 0 =
  no reminder).

## 2. Data — migration `…_requests` (additive only)

- `service_requests`: `id` (REQ-YYYY-NNNN), `status` (NEW · ACCEPTED ·
  DECLINED · CANCELLED), `description`, `place`, `site`, `assetId`,
  `pointCode`, `category`, `urgent`, `requesterName`, `requesterEmail`,
  `requesterPhone`, `lang` (en|ms), `source` (PORTAL · POSTER · STAFF),
  `trackSalt`, `jobId`, `merged` (added to an existing work order),
  `decidedBy`, `decidedAt`, `declineReason`, `spam`, `rating`,
  `ratingComment`, `ratedAt`, `remindedAt`, `doneNotifiedAt`, `ipHash`,
  `createdAt`, `version`. Indexes on `status`, `jobId`, `createdAt`.
- `request_messages`: `id`, `requestId`, `from` (TEAM · REQUESTER), `by`,
  `body`, `at`.
- `request_points` (a poster): `code` (8 random characters, unguessable),
  `label`, `site`, `assetId`, `active`, `createdBy`, `createdAt`.
- Attachments accept the entity `REQUEST`.

Work orders are not changed; a request points at its work order, and one work
order can have several requests (duplicates).

## 3. The public side

No cookies, no session. Routes under `/public`, resolved to the organisation
by web address like everything else:

| Route | Does |
|---|---|
| `GET /public/portal?p=CODE` | Organisation name, intro, whether the form is open and needs a code, sites, categories, and the poster's place or asset |
| `POST /public/requests` | Multipart: the fields and up to 3 photos → `{ id, track }` |
| `POST /public/track` | `{ token }` → the requester's view |
| `POST /public/track/messages` | `{ token, body }` |
| `POST /public/track/rating` | `{ token, rating, comment }` |
| `POST /public/track/cancel` | `{ token }` — only while NEW |

**The form** asks: what is wrong (required, ≤ 1,000 characters), where (site
when there are several; a free-text place), type of problem (optional), "this
is urgent or a safety hazard", name (required), email or phone (at least
one), up to three photos, and the access code if one is set. From a poster the
place or asset is fixed, and a valid active poster code counts as access — a
scan needs no access code.

**The tracking link** is `/r/track#<id>.<signature>`. The signature is an
HMAC of the organisation, the request id and its `trackSalt`, under a key
derived from `AUTH_SECRET`; nothing is stored, links can be re-made for every
email, and changing the salt cancels a link. It sits in the URL fragment, so
it never reaches web-server logs or `Referer` headers; the page sends it in
request bodies. A wrong token and an unknown request both answer 404.

**What the requester sees**: the reference, what they sent, the number of
photos, a plain stage — *Received → Accepted → In progress → Waiting (parts /
approval / contractor) → Done* — taken from the work order's status phase, the
decline reason, and the messages. Never: internal status names, staff
contact details, costs, the audit trail, or the photos themselves.

**Emails** (when the requester gave an address and mail is configured), in
the language they used: received, accepted (or added to an existing work
order), declined with the reason, a message from the team, and done — with
the link to rate. Email stays best-effort.

## 4. Protections

This is the first part of the system open to the internet without sign-in.

- Module off or `open: false` → 404 for every public route.
- Throttles per address: 5 submissions a minute and 20 an hour; 60 tracking
  reads a minute; 10 messages an hour per request, 50 in total; at most 3
  requests an hour per email address. At most 500 NEW requests per
  organisation — beyond that the form says the help desk is busy.
- A hidden field that people leave empty; a filled one is silently dropped.
- The access code is compared in constant time.
- Text is length-limited, stored as plain text and shown escaped. The
  **received** email contains only the reference and the link — never the
  requester's own words — so the form cannot be used to send someone
  arbitrary mail.
- Photos: JPEG, PNG or WebP by content (not by name), ≤ 5 MB each, three at
  most; the browser shrinks them and strips location data before sending.
  Only signed-in staff can open them.
- Spreadsheet exports already neutralise cells that start with `=`, `+`, `-`
  or `@`; the new report uses the same writer.
- `ipHash` (a keyed hash, not the address) is kept for spotting abuse.
- *Decline as spam* deletes the request's photos and contact details.
  *Erase contact details* (`requests.manage`) blanks name, email and phone on
  any decided request, for a personal-data request.

## 5. Triage (staff)

`/requests`, behind `requests.manage`:

- `GET /requests?status=&q=`, `GET /requests/:id` (with messages, photos, and
  **possible duplicates**: open work orders on the same asset or from the same
  poster).
- `POST /requests/:id/accept` `{ assetId?, category, site, jobType?,
  component? }` → registers a work order (the description becomes its first
  note; photos move onto it), links the request, tells the requester.
- `POST /requests/:id/merge` `{ jobId }` → links to an open work order.
- `POST /requests/:id/decline` `{ reason, spam? }`.
- `POST /requests` — staff log a request for a caller (source STAFF), so the
  caller also gets a tracking link.
- `POST /requests/:id/messages` `{ body }`; `POST /requests/:id/erase`.
- `GET /jobs/:id/requests` — a work order's requesters, messages and ratings.

New requests notify people with `requests.manage` (urgent ones say so). A
request still NEW after `triageHours` reminds them once. When a linked work
order reaches a *done* phase, each requester is told once. A reply from a
requester notifies `requests.manage` holders and the work order's assignee.
A rating of 1 or 2 notifies `requests.manage` holders.

To avoid a circular dependency: `RequestsModule` (data, tokens, emails, the
public controller; no dependency on jobs) is imported by `JobsModule` for the
"work is done" hook; `RequestsInboxModule` (triage) imports both.

## 6. Rating and reporting

One rating per request, 1–5 with an optional comment, once the work is done.
Shown on the work order. Dashboard: *New requests* and *Satisfaction (90
days)*. Report `/reports/requests?from&to` (`requests.manage`): each request
with its outcome, work order, hours to accept, days to complete and rating;
a summary by site and category.

## 7. QR posters

`GET|POST /requests/points`, `PATCH /requests/points/:code` (label, active),
`GET /requests/points/posters?codes=&format=poster|stickers`:

- **Poster** — A4, one per page: "Report a problem / Laporkan masalah", a
  large QR, the place, the organisation's name.
- **Stickers** — the existing 2 × 5 label sheet, for assets.

From the asset register, *Request stickers* creates points for the listed
assets (up to 100) and prints them. Deactivating a point makes its QR open
the plain form. Each point shows how many requests it has produced.

## 8. Screens

Public, phone-first, English and Bahasa Melayu (browser language, with a
toggle), outside the signed-in shell:

- `/r` (`?p=CODE` from a poster) — the form; then a confirmation with the
  reference and the tracking link to save.
- `/r/track` — stage, messages with a reply box, cancel while NEW, rating
  when done.

Staff:

- **Requests** in the menu, with the count of new ones: tabs New · Accepted ·
  Declined · All; a request panel with photos, contact, duplicates, and
  Accept / Add to a work order / Decline / Message; *+ Log a request*.
- **QR posters** tab: add a place, print, deactivate.
- Work order page: a **Requester** panel — who asked, messages (send one),
  rating. Phone job screen: the requester's name and a tap-to-call number.
- Settings: the portal block, with the public link to copy.
- Dashboard cards; the report.

## 9. Tests

Unit: token make/verify (tamper, other organisation, changed salt), stage
from status phase, email texts, form validation.

Integration (fleet and facilities demo organisations): module off and closed
→ 404; access code; poster bypasses the code; trap field; limits on text,
photos and rates; tracking with good and bad tokens; accept → work order,
note, photos, email; merge; decline and spam purge; cancel; messages both
ways with notifications; done → email once; rating once and the low-rating
alert; posters and stickers PDFs; a deactivated point; triage reminder; erase;
the report; staff-logged request; aviation untouched.

Browser (`scripts/portal-check.js`): on an emulated phone, scan a poster
link, send a request with a photo; staff accept it on the desktop and send a
message; the requester replies; the technician completes the work; the
requester rates it.

## 10. Build order

1. Data, module, permission, settings; public submit and track; tokens;
   emails.
2. Triage: inbox API, accept / merge / decline / spam / erase, staff-logged
   requests, the done hook, the reminder.
3. Messages, rating, dashboard, report.
4. Points, posters and stickers.
5. Public pages.
6. Staff screens.
7. Browser run, documentation (user guides, administrator guide, security
   overview, API guide, README; this document becomes
   `docs/architecture/request-portal.md`), CI checks, push.
