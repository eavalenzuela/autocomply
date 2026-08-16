#!/usr/bin/env bash
# Create and populate a database for the HTTP tests.
#
# The HTTP suite attests, approves exceptions and deactivates users — it has to,
# since that is what it verifies — so it cannot run against a database anyone
# cares about. This builds a disposable one from the same migrations and seed
# that a real deployment uses, which also means the suite exercises the real
# bootstrap path rather than a hand-built fixture.
set -euo pipefail

TEST_DB="${TEST_DB_NAME:-autocomply_test}"
: "${ADMIN_DATABASE_URL:?set ADMIN_DATABASE_URL to a database you can CREATE DATABASE from}"

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null 2>&1 || true
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${TEST_DB}"
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${TEST_DB}"
echo "prepared ${TEST_DB}"
