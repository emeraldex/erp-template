# Backup and restore

The production stack (`docker-compose.prod.yml`) runs a `backup` service that
takes a verified `pg_dump` of the database every `BACKUP_INTERVAL_HOURS`
(default 24) and keeps `BACKUP_KEEP_DAYS` (default 14) of them in
`BACKUP_HOST_DIR` (default `./backups`) on the host.

A backup that only exists on the same server is not a backup. **Copy
`BACKUP_HOST_DIR` to separate storage** (another machine, S3-compatible object
storage, or the customer's backup system) at least daily.

## Attachments are not in the dump

Uploaded files are stored outside PostgreSQL. The database dump holds their
names and SHA-256 fingerprints, not their bytes.

- **`STORAGE_DRIVER=local`** (default): files are on the `attachments` Docker
  volume. Back it up alongside the dumps, for example nightly:

  ```bash
  docker run --rm -v maintenance-erp_attachments:/data:ro -v "$PWD/backups:/out" alpine tar czf /out/attachments-$(date -u +%Y%m%dT%H%M%SZ).tar.gz -C /data .
  ```

  Restore by extracting the archive back into the volume with the API stopped.
- **`STORAGE_DRIVER=s3`**: rely on the bucket's own versioning and replication;
  turn on versioning so an overwritten or deleted object can be recovered.

After any restore, `GET /api/v1/attachments/file/<id>/verify` (QUALITY or MM)
confirms a file matches the fingerprint recorded for it.

## What is in a dump

A custom-format `pg_dump` (`erp-YYYYMMDDTHHMMSSZ.dump`) of the whole database:
jobs, demands, outside-vendor repairs, invoices, registers, audit entries, form
records, workflow rules, users (password hashes only) and sessions. Each file is
checked with `pg_restore --list` before it is kept; a dump that fails the check
is deleted and the failure is logged.

## Check that backups are running

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs --tail 20 backup
```

```bash
ls -lh backups/
```

Each run logs `[backup] wrote …`. An `ERROR` line means that run produced no
backup; the service retries on the next cycle.

## Take a backup now

Before an upgrade or a risky change:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm -e BACKUP_INTERVAL_HOURS= backup
```

## Restore

`scripts/ops/restore.sh` replaces the contents of the target database with the
dump, in a single transaction: if anything fails, the target is left unchanged.
It asks you to type `RESTORE` before it starts.

### 1. Rehearse on a scratch database first

Do this at least once when the system goes live, and after major upgrades, so
you know the backups actually restore.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec db createdb -U "$POSTGRES_USER" erp_restore_check
```

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm \
  -v "$PWD/scripts/ops/restore.sh:/restore.sh:ro" --entrypoint sh backup \
  /restore.sh /backups/<file>.dump "postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@db:5432/erp_restore_check"
```

The script prints row counts for users, jobs, invoices and audit entries.
Compare them with the live system, then drop the scratch database:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec db dropdb -U "$POSTGRES_USER" erp_restore_check
```

### 2. Restore the live database

1. Stop the API and web so nobody writes during the restore:
   `docker compose -f docker-compose.prod.yml --env-file .env.prod stop web api`
2. Take a backup of the current state, even if it is damaged (see *Take a backup now*).
3. Run the restore against the live database name (`erp` by default), using the
   same command as the rehearsal with the live database in the URL.
4. Start the stack again:
   `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d`
5. Sign in and check recent jobs and invoices. Every user is signed out, because
   sessions are restored from the dump's point in time.

## Recovery objectives

With the defaults, at most 24 hours of work can be lost (recovery point), and a
restore of a database this size takes minutes. For a tighter recovery point,
lower `BACKUP_INTERVAL_HOURS`, or add PostgreSQL WAL archiving (for example with
pgBackRest) for point-in-time recovery.
