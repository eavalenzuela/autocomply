#!/usr/bin/env bash
# Restore an autocomply dump into a target database.
#
#   ./deploy/restore.sh backups/autocomply-<ts>.dump "$TARGET_DATABASE_URL"
#
# The target database must already exist and should be EMPTY. This deliberately
# does not take DATABASE_URL from the environment: restoring is the one
# operation where defaulting to "the database we normally talk to" is how you
# overwrite production while trying to test a backup.
set -euo pipefail

DUMP="${1:?usage: restore.sh <dump-file> <target-database-url>}"
TARGET="${2:?usage: restore.sh <dump-file> <target-database-url>}"

[ -f "$DUMP" ] || { echo "no such dump: $DUMP" >&2; exit 1; }

case "$TARGET" in
  *"/autocomply"|*"/autocomply?"*)
    echo "refusing: '$TARGET' looks like the primary database." >&2
    echo "Restore into a scratch database and swap, so a failed restore cannot destroy the original." >&2
    exit 1
    ;;
esac

# --clean --if-exists so a partially-populated target is replaced rather than
# merged. --no-owner/--no-acl to match how backup.sh writes the dump.
pg_restore --dbname "$TARGET" --clean --if-exists --no-owner --no-acl "$DUMP"

echo "restored $DUMP -> $TARGET"
echo "Verify before trusting it — row counts, and that the audit trail is intact:"
echo "  psql \"\$TARGET\" -c 'select action, count(*) from audit_log group by action order by 2 desc'"
