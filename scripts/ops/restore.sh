#!/bin/sh
# Restore a dump made by backup.sh into a database. DESTRUCTIVE for the target:
# existing objects are dropped and replaced.
#
#   scripts/ops/restore.sh <dump-file> <target-database-url>
#
# Run against a scratch database first (see docs/operations/backup-and-restore.md).
set -eu

dump="${1:?usage: restore.sh <dump-file> <target-database-url>}"
target="${2:?usage: restore.sh <dump-file> <target-database-url>}"
[ -f "$dump" ] || { echo "no such file: $dump" >&2; exit 1; }

pg_restore --list "$dump" >/dev/null || { echo "not a readable pg_dump archive: $dump" >&2; exit 1; }

printf 'Restore %s into %s, replacing its contents? Type RESTORE to continue: ' "$dump" "${target%%\?*}"
if [ "${RESTORE_CONFIRM:-}" = "RESTORE" ]; then echo "RESTORE (from RESTORE_CONFIRM)"; else read -r answer; [ "$answer" = "RESTORE" ] || { echo "aborted"; exit 1; }; fi

pg_restore --clean --if-exists --no-owner --exit-on-error --single-transaction --dbname="$target" "$dump"
echo "restored. Row counts:"
psql "$target" -Atc "select 'users', count(*) from users union all select 'jobs', count(*) from jobs union all select 'invoices', count(*) from invoices union all select 'audit entries', count(*) from audit_entries" | tr '|' ' '
