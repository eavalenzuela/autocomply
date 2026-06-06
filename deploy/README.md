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
docker compose -f deploy/docker-compose.prod.yml run --rm api npm --prefix server run db:push
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
