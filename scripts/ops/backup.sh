#!/bin/sh
# Database backups for the production stack (runs in the `backup` service).
#
# Takes a compressed custom-format pg_dump, checks it can be read back, then
# prunes dumps older than BACKUP_KEEP_DAYS. With BACKUP_INTERVAL_HOURS set it
# loops forever; without it, it takes one backup and exits (for cron or ad hoc).
#
# Requires the standard libpq variables: PGHOST, PGUSER, PGPASSWORD, PGDATABASE.
set -eu

DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$DIR"

backup_once() {
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  final="$DIR/${PGDATABASE}-${stamp}.dump"
  partial="$final.partial"
  echo "[backup] $(date -u +%FT%TZ) dumping ${PGDATABASE}@${PGHOST}"
  if ! pg_dump --format=custom --compress=6 --no-owner --file="$partial"; then
    rm -f "$partial"; echo "[backup] ERROR: pg_dump failed" >&2; return 1
  fi
  # A dump that pg_restore cannot list is not a backup.
  if ! pg_restore --list "$partial" >/dev/null; then
    rm -f "$partial"; echo "[backup] ERROR: dump failed verification" >&2; return 1
  fi
  mv "$partial" "$final"
  echo "[backup] wrote $final ($(du -h "$final" | cut -f1))"
  find "$DIR" -name "${PGDATABASE}-*.dump" -type f -mtime +"$KEEP_DAYS" -print -delete | sed 's/^/[backup] pruned /'
}

if [ -z "${BACKUP_INTERVAL_HOURS:-}" ]; then
  backup_once
  exit $?
fi

# Wait for the database before the first run.
until pg_isready -q; do echo "[backup] waiting for database"; sleep 5; done
while true; do
  backup_once || echo "[backup] will retry next cycle" >&2
  sleep "$((BACKUP_INTERVAL_HOURS * 3600))"
done
