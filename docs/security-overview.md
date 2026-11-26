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
