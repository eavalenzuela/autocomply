# Deploy

Single-host production stack for autocomply: **Postgres + Fastify API + Caddy**
(TLS + static SPA + `/api` reverse proxy), all via docker-compose. Everything is
served same-origin behind Caddy, so the cookie-based auth works without CORS.

```
Internet ──443/80──► Caddy ──► /        static SPA (built dist/)
                           └─► /api/*   api:3001 (Fastify)
                                  └────► db:5432 (Postgres, internal only)
```

## One-time setup on the host

Requires Docker + the compose plugin. Then:

```bash
git clone https://github.com/eavalenzuela/autocomply /opt/autocomply
cd /opt/autocomply
cp deploy/.env.prod.example deploy/.env.prod
# edit deploy/.env.prod: set POSTGRES_PASSWORD, DATABASE_URL (same pw), ADMIN_PASSWORD
docker compose -f deploy/docker-compose.prod.yml up -d --build
# initialize the database (fresh DB → no drizzle prompts):
docker compose -f deploy/docker-compose.prod.yml run --rm api npm --prefix server run db:migrate
docker compose -f deploy/docker-compose.prod.yml run --rm api npm --prefix server run db:seed
```

`db:seed` creates the control catalog, frameworks, crosswalk, and a **single admin**
from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (no shared-password demo users, since
`SEED_DEMO_USERS` is unset). To re-seed demo users locally, set `SEED_DEMO_USERS=true`.

## TLS

Caddy obtains a Let's Encrypt cert automatically the first time the domain in
`Caddyfile` resolves to this host and ports 80/443 are reachable. Point the DNS
A record at the host's public IP first; the cert appears within ~a minute.

## Notes

- `deploy/.env.prod` is gitignored — never commit real secrets.
- DB and API have **no published host ports**; only Caddy is exposed (80/443).
- The Postgres volume (`pgdata`) and Caddy's cert volume (`caddy_data`) persist
  across restarts. Back up `pgdata` (e.g. nightly `pg_dump`) for durability.
- Local dev is unchanged: `docker compose up -d db` + `npm run dev:all`.

## Schema changes

Schema reaches a database through committed migrations, never `drizzle-kit push`.
`push` diffs the schema file against whatever it finds and applies the
difference: no review, no ordering, no record of what ran, and no way to express
anything the schema file cannot describe — the `audit_log` append-only triggers,
for instance. It is fine against a scratch database and unsafe against one with
data in it.

```bash
npm --prefix server run db:generate   # after editing src/db/schema.ts
# review the generated SQL in server/drizzle/, then commit it
npm --prefix server run db:migrate    # apply pending migrations
```

## Backups

```bash
DATABASE_URL=... ./deploy/backup.sh          # -> ./backups/autocomply-<ts>.dump
./deploy/restore.sh <dump> "$SCRATCH_URL"    # restore into a scratch database
```

`restore.sh` refuses a target that looks like the primary database: restore into
a scratch copy and swap, so a failed restore cannot destroy the original.

This matters more here than in most applications. The audit trail is append-only
in the database, so there is no in-application way to recover from losing it — a
dump is the only recovery path that exists. **Restore periodically, not once.** A
backup nobody has restored is a hypothesis. The round trip has been verified
once (dump → fresh database → row counts matched, and the append-only triggers
survived the restore); that verification is a starting point, not a guarantee
about future dumps.
