# Security overview

A factual summary for client security reviews and procurement questionnaires.
It describes what the software does; how it is hosted (network, disks,
monitoring) is up to whoever operates it.

## Architecture

- Three components: a web app (Next.js), an API (NestJS) and PostgreSQL 16,
  shipped as containers. The database is on an internal network the web app
  cannot reach. A TLS reverse proxy fronts both web and API on one address.
- Every request is handled within one client organisation. Each organisation's
  data lives in its own PostgreSQL schema; queries are generated against that
  schema only, and code running outside an organisation context fails rather
  than defaulting to one. Automated tests check that records, sessions,
  settings, attachments and background jobs never cross organisations.
- Single-organisation installations on the client's own servers are supported
  unchanged.

## Identity and access

- **Passwords**: scrypt-hashed (N=2^15). New passwords need 12+ characters and
  are checked against the user's email name and common choices. Accounts lock
  after 5 failures for 15 minutes (configurable). Sign-in is rate-limited per
  IP. Failure messages do not reveal whether an account exists.
- **Single sign-on**: OpenID Connect authorization-code flow with PKCE, state
  and nonce; ID tokens verified against the provider's published keys (issuer,
  audience, expiry). Users are matched by verified email and never created
  automatically. An organisation can require SSO; administrators keep a
  password as a break-glass.
- **Sessions**: server-side, referenced by an HMAC-signed token in an
  `httpOnly`, `SameSite=Strict`, `Secure` cookie. They end on sign-out, after 60
  minutes idle, after 8 hours, on password change (other devices), on password
  reset and on deactivation. A session is valid only at its own organisation.
- **CSRF**: cookie-authenticated changes require a custom header a cross-site
  form cannot send; cookies are `SameSite=Strict`.
- **Authorisation**: ten roles mirror the procedures' process owners. Each
  workflow step names the roles that may take it, enforced on the server.
  Administration (users, settings, SSO, workflow editor) is limited to ADMIN
  (and QUALITY for workflows). Users are deactivated, never deleted.

## Data protection

- **In transit**: TLS at the reverse proxy; HSTS in the example configuration.
- **At rest**: database and volume encryption are provided by the hosting
  platform. Attachments in S3-compatible storage use server-side encryption.
  SSO client secrets are encrypted with AES-256-GCM.
- **Integrity**: the audit trail is append-only in the application. Every
  workflow step records who, role, when and the values entered. Attachments are
  fingerprinted (SHA-256) at upload and checked on every download.
- **Retention**: closed records are archived out of active lists after a year
  and retained at least five years; nothing is deleted automatically.
- **Exports**: CSV exports neutralise spreadsheet formula injection; file
  downloads are served as attachments with `nosniff` and a sandbox policy.

## Data on phones

- The phone app keeps copies of the person's assigned work orders (and ones
  opened in the last 7 days), the organisation's lists and their own unsent
  changes, in the browser's storage for that site, separately per
  organisation address and person. It never stores passwords or tokens: the
  session stays in the httpOnly cookie.
- Signing out removes the cached copies; unsent changes stay on the phone for
  the same person and are never shown to another user. **More → Remove offline
  copies** clears them on demand.
- Photos are re-encoded on the phone before upload, which drops their
  metadata, including GPS location.
- Resent offline changes carry an id (`X-Client-Op`) so each applies once.
- The service worker caches only the app's own pages and static files; it
  never intercepts API calls. Building with `NEXT_PUBLIC_PWA=0` removes it from
  every phone.
- Lost or shared phones: deactivate the user (sessions end at once) and, if
  needed, ask them to clear the site's data.

## Application security

- Security headers (helmet); CORS limited to known web addresses.
- Input validated on the server; uploads restricted by type, contents and size.
- Logs contain one line per request (method, path, status, duration, user id)
  and never request bodies, query strings or headers.
- Changes to workflow configuration and user accounts are logged with before
  and after values.

## The public request portal

The request portal is the only part open to the internet without signing
in. It is off unless the organisation switches it on, and then:

- It can create a request and read or update that one request — nothing
  else. Every other address still needs a session.
- Each request has a private tracking link: an HMAC (keyed with a secret
  derived from `AUTH_SECRET`) of the organisation, the request and a random
  salt. It sits after `#` in the address, so it never reaches server logs or
  other sites, and travels in request bodies. A wrong or altered link and an
  unknown request get the same *not found*. Erasing a requester's details
  changes the salt, so old links stop working.
- The requester sees their own request, its stage in plain words and the
  messages — never staff names, internal statuses, costs, audit trails or
  photos.
- Abuse: rate limits per address (configurable) and per email address, a cap
  on waiting requests, a hidden field automated form-fillers fill in, an
  optional access code compared in constant time, and QR codes that are
  random and can be switched off.
- Photos: JPEG, PNG or WebP recognised by content, 5 MB at most, three per
  request; the browser shrinks them and strips location data first; only
  signed-in staff can open them.
- Email: confirmation emails carry only the reference and the link, never
  the requester's words, so the form cannot be used to send someone
  arbitrary mail.
- The pages are kept out of search engines and send no `Referer`. Only a
  keyed hash of the sender's network address is kept, for spotting abuse.

## The organisation's logo

The logo is the only other thing served without signing in (`GET
/tenant/logo`), because the sign-in page and the request portal show it.

- **What is accepted:** PNG or JPEG only, recognised by content, at most
  512 KB. SVG is refused, because it can carry scripts.
- **How it is served:** with `X-Content-Type-Options: nosniff` and
  `Content-Security-Policy: default-src 'none'`, so even a disguised file
  cannot run in the browser.
- **Who can change it:** only administrators.

## Labour cost and rates

Hourly rates and labour cost are pay information. The API returns them only
to people with `labour.manage`; for everyone else the fields are left out or
`null`. That includes totals that contain labour: job cost, and asset cost
(which `reports.maintenance` may also see). Hours worked are visible to
anyone who can see the work order.

## Exchange rates

Only people with `fx.manage` can change the rate table, or type a rate on a
transaction. For anyone else, a rate sent with a request is ignored and the
table's rate is used.

- **Typing mistakes:** a rate more than 20% from the previous one must be
  confirmed. The same applies to the rate implied by an amount received.
- **Recorded amounts are fixed:** each transaction keeps its own copy of the
  rate, so changing or deleting a rate never alters what was recorded.
- **Who can read rates:** anyone signed in, because forms show the
  conversion.

## Engineering practice

- Automated tests run on every change (unit and integration tests against
  PostgreSQL, including tenant isolation and SSO attack cases), with type
  checks, builds and an end-to-end scenario from the RFP.
- Dependencies are audited on every change and the build fails on any high or
  critical advisory.

## Operations

- Health endpoint for monitoring; structured JSON logs.
- Nightly verified database backups with a documented, rehearsed restore.

## Not yet provided

- Multi-factor authentication inside the ERP (available through the client's
  identity provider when SSO is used).
- Error tracking service integration.
- An independent penetration test.
