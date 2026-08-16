#!/usr/bin/env bash
# Back up the autocomply database.
#
# There was no backup story at all, which matters more here than in most
# applications: the audit trail is append-only by design, so there is no
# in-application way to recover from losing it. A dump is the only recovery
# path that exists.
#
#   ./deploy/backup.sh                      # -> ./backups/autocomply-<ts>.dump
#   BACKUP_DIR=/srv/backups ./deploy/backup.sh
#
# Requires DATABASE_URL (or PG* variables) and pg_dump >= the server version.
# Custom format (-Fc): compressed, and restorable selectively with pg_restore.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is not set — refusing to guess which database to back up}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/autocomply-${STAMP}.dump"

mkdir -p "$BACKUP_DIR"

# --no-owner/--no-acl so the dump restores into a database owned by whoever is
# doing the restoring, which is rarely the same role that made it.
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl --file "$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
echo "backup written: $OUT ($SIZE)"

# A backup nobody has restored is a hypothesis. Print the command that tests it.
cat <<EOF

To verify this dump actually restores (do this periodically, not once):

  createdb autocomply_restore_check
  ./deploy/restore.sh "$OUT" postgresql://USER:PASS@HOST:PORT/autocomply_restore_check
  # compare row counts against the source, then:
  dropdb autocomply_restore_check
EOF
