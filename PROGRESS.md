# Build Progress — autonomous session (2026-05-22 night)

Working through `ROADMAP.md` phases. Verified against a live Postgres (Docker).

## Environment note
- Port 5432 was already taken by another project's container (`grcen-db-1`), so
  autocomply's Postgres is mapped to **host port 5433** (see `docker-compose.yml` /
  `server/.env`). The app DB is `autocomply` on 5433.

## How to run (your morning checklist)
```bash
docker compose up -d        # Postgres on :5433
npm install                 # root (if needed)
npm install --prefix server # server (if needed)
npm run db:setup            # push schema + seed + collect + docs + monitor (one shot)
npm run dev:all             # web (:5173) + api (:3001) together
# open http://localhost:5173 → log in (quick-login buttons; pw: autocomply)
```
**Accounts** (all pw `autocomply`, `@autocomply.local`): `admin`, `cm`, `owner` (assigned
01.a/01.q/09.aa/10.f), `auditor` (30-day time-boxed), `viewer`. Log in as the Control Owner
and try attesting an unassigned control to see the 403 scoping; as Admin, visit Admin to
manage roles/assignments.
**Heads-up:** the sandbox reclaimed the Docker container between runs at least once this
session, and the named volume may not persist. If `/api/*` returns 500, the DB is gone —
just `docker compose up -d` then `npm run db:setup` again to rebuild it from `data/*.yaml`.
(Hardened the connection fallback to :5433 so a misconfigured env can never hit the
neighbor project's Postgres on :5432.)

## Phase 0 — Walking skeleton ✅ (complete + verified)
- **Postgres + Drizzle schema** (`server/src/db/schema.ts`): structural CCF library,
  frameworks/crosswalk, auth baseline, evidence/attestation, checks/findings.
- **Source-agnostic loader** (`server/src/loader.ts`) → `seed.ts` seeds `data/*.yaml`.
  Verified: 14 categories / 49 objectives / 156 controls / 184 requirements / 348 mappings.
- **Fastify API** (`server/src/app.ts`): `/api/health`, `/api/matrix`, `/api/control/:code`,
  `/api/attest`, `/api/worklist`, `/api/me`.
- **Matrix UI wired to the live API** (`src/api.ts`, `src/App.tsx`) — replaced the mock.
  Real 156 controls grouped by the 14 categories, real crosswalk badges, unrated cells,
  KPI strip showing real totals. Verified end-to-end through the Vite proxy.
- **Baseline auth + RBAC** (`server/src/auth.ts`): 5 roles, write-role gating +
  control-owner assignment scoping on `/api/attest`; dev identifies user via `x-user-email`
  (full SSO is Phase 3). Append-only **audit log** writing on seed + attest.

## Phase 1 — e1/i1 slice 🟡 (in progress)
- **Attestation flow** (append-only) — `/api/attest`; matrix recomputes scores/cells live.
  Verified: attesting `01.a impl=fc` → score 100, impl cell filled.
- **Scoring** (`server/src/scoring.ts`) — normalized weighted maturity score (Implemented
  40% etc.); domain roll-up + gate (0–5, fail <3.0). Simplified vs Phase-4 r2 scoring.
- **Simulated AWS collector** (`server/src/collectors/simulate.ts`) — Check / CheckRun /
  AutomatedFinding + completeness + rubric → AWS-suggested `impl` attestations (marker
  `aws`), incl. one coverage-gap → NC case. Exercises the real P1 pipeline w/o AWS creds.
- **Worklist v1** — `/api/worklist`: clock-starter (unrated impl) + confirm-aws tasks.

## Phase 0/1 UI shell ✅ (added this session)
- **Global nav shell** (`src/components/shell.tsx`): left sidebar with the full IA
  (Dashboard, Programs ▸ Control Matrix / Requirements / Periods, Worklist, Evidence,
  Controls, Risks, Integrations, Reports, Admin). Live pages tagged; stubs show their
  roadmap phase. Matrix is the default page.
- **Interactive drawer** (`src/components/Drawer.tsx`): clicking a control fetches
  `/api/control/:code` → live crosswalk + attestation history + a maturity ladder, plus
  an inline **attest** form (pick dimension → click a rating → POST `/api/attest` → the
  matrix refreshes live). Verified: attesting recomputes scores/cells immediately.
- **Worklist page** — renders `/api/worklist` (priority, control, reason, type).
- Frontend build clean (38 modules, strict tsc).

## Current demo state (after seed + collect)
- 156 controls, 3 domains scored: Access Control 38% (gate 1.9 — FAILING, due to the
  `01.r` coverage-gap→NC), Comms/Ops 83% (gate 4.2), ISADM 88% (gate 4.4). Worklist 155.
- 7 controls have AWS-fed Implemented ratings (markers visible on the matrix).

## Phase 2 — Continuous monitoring + remediation ✅ (added this session)
- **Document evidence + drift detection**: `db:docs` seeds linked policy/procedure docs
  (snapshot-hashed) + the matching human Policy/Process attestations. `db:monitor`
  performs a monitoring tick — detects a changed source hash on `01.q`'s policy doc →
  flags `drifted`, marks the backing attestation `marker=drift`, audit-logs the event.
  The matrix shows the drift marker; the evidence page shows current vs drifted.
- **Exceptions / risk acceptance with enforced SoD**: `exceptions` table; `/api/exception`
  (request), `/api/exception/:id/decide` (approve/reject). **SoD enforced** — the requester
  cannot approve their own (verified 403); only admin/compliance_manager can decide.
  Seeded one approved+expiring-soon and one pending.
- **Worklist v2**: composed/prioritized — drift (88) > coverage-gap (84) > approve-exception
  (78) > exception-expiring (72) > confirm-aws (70) > document-policy (46, PRISMA dep) >
  initial-assessment (50). Specific in-flight issues surface above the generic bulk.
- **Notifications** (`/api/notifications`, computed): drift / coverage-gap /
  exception-expiring / exception-pending. Surfaced as an Alerts feed on the Worklist page.
- **Frontend**: Evidence page + Risks & Exceptions page (with approve/reject) — both now
  live in the nav (no longer stubs). Verified all endpoints 200 through the Vite proxy.

## Phase 3 — auth + admin (added this session)
- **Real local-account sessions** replace the `x-user-email` dev stub: scrypt password
  hashing (no new crypto deps), session token in an httpOnly cookie (`@fastify/cookie`),
  `sessions` table. `/api/login`, `/api/logout`, `/api/me`. The header fallback remains
  for scripts/curl. Verified cookies survive the Vite proxy.
- **5 seeded accounts** (password `autocomply`): admin, compliance_manager, control_owner,
  **auditor (time-boxed, 30-day expiry)**, viewer. Login is enforced (the app shows a login
  screen with quick-login buttons per role).
- **RBAC + assignment-scoping verified through real sessions**: Control Owner can attest an
  **assigned** control but gets 403 on an unassigned one; non-admin/CM gets 403 on admin
  endpoints; expired auditor is rejected.
- **Admin Users page**: list users, change roles (admin-only), add/remove control
  assignments (admin/CM). Live in nav.
- **Topbar** shows the signed-in user + role + Sign out.
- *SSO/SCIM/MFA remain the P3 remainder* — this is the local-account foundation they plug into.

## Phase 4 — partial (added this session)
- **Requirements view + crosswalk gap report** (the reverse roll-up): `/api/requirements
  ?framework=soc2|iso27001` walks the crosswalk backwards — each requirement gets a status
  (met/partial/weak/unassessed/**gap**) from its mapped controls' scores weighted by
  relationship, plus a framework **readiness** %. UI page with framework toggle, summary
  tiles, gaps-only filter, gap highlighting. Verified: SOC 2 = 51 covered / 10 gaps /
  readiness 81; ISO = 87 covered / 36 gaps. The gaps match exactly what `gen_crosswalk.py`
  predicted (ISMS clauses + new-2022 controls + COSO/privacy criteria).
- **Dashboard** (org posture landing): controls/domains/gates/crosswalk tiles, per-framework
  readiness cards (→ Requirements), gate-failing domains (→ Matrix), alerts feed.
- Nav: dashboard / requirements now live. 7 of 11 IA sections are live.

## Phase 5 — reporting + auditor view (added this session)
- **Auditor evidence package** — `/api/report?framework=soc2|iso27001` assembles the full
  audit deliverable: readiness summary, requirement-coverage table, coverage gaps, per-control
  evidence (ratings across all 5 dimensions + linked evidence w/ hashes + drift flags),
  exceptions. **Reports page** renders it as a print-styled document with **Download JSON**
  and **Print / PDF** (print CSS hides nav/chrome). Verified both frameworks via proxy.
- **Read-only roles enforced in the UI**: auditor/viewer don't see the attest box (Drawer),
  exception approve buttons, or admin role controls. Backend already blocks the writes
  (auditor attest → 403, verified); this removes the dead affordances.

## Backlog clearance (added this session) — every nav section is now live
- **Monitoring scheduler**: `runMonitorTick()` refactored out of `db:monitor`; the server
  runs it on an interval when `MONITOR_INTERVAL_MS` is set (verified: logs `monitor
  scheduler on`). Real deploys would use cron; in-process interval suffices for single-org.
- **Integrations page** (`/api/integrations`): connector/collector health derived from
  Checks/CheckRuns/Findings — per source-kind status (healthy/degraded from CheckRun
  completeness), checks, pass rate, coverage; plus a document-sources card with drift count.
- **Controls (CCF) library page** (`/api/controls`): all 156 with category, objective,
  per-framework crosswalk counts, current score; client-side filter.
- **Assessment Periods page** (`assessment_periods` table + `/api/periods` CRUD + status
  cycle): period lifecycle (planning→active→closed) + **SOC 2 TSC category selection**.
  Seeded a HITRUST r2 active period + a SOC 2 Type II planning period.
- Refactored `computeRequirements()` shared by `/api/requirements` and `/api/report`.

## SSO (added this session) — GitHub + Google OAuth/OIDC
- `server/src/oauth.ts`: `/api/auth/providers`, `/api/auth/:provider`, `/api/auth/:provider/callback`.
  Client id/secret read from **env only** (never in code/logs); SSO buttons appear on the
  login screen only when a provider is configured. State cookie for CSRF.
- On callback: resolve IdP email → link existing local user **or JIT-provision** a new one
  at least-privilege (`viewer`, configurable via `SSO_DEFAULT_ROLE`); create session.
  `users.auth_provider` tracks local/github/google. MFA is delegated to the IdP.
- **To enable** (operator does this; secrets go in `server/.env`, gitignored):
  - GitHub: Settings → Developer settings → OAuth Apps → New. Homepage `http://localhost:5173`,
    callback `http://localhost:5173/api/auth/github/callback`. Set `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.
  - Google: Cloud Console → Credentials → OAuth client ID (Web). Redirect URI
    `http://localhost:5173/api/auth/google/callback`. Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
  - Restart the API; the SSO button appears. First SSO login creates a `viewer` — elevate
    via the local `admin@autocomply.local` account → Admin.
  - Verified here (with fake env): providers gating + correct authorize redirect. The live
    token-exchange/JIT round-trip is for the operator to test with a real app + browser.

## Step-up re-auth (added this session)
- **Sensitive actions require a fresh password re-verify**: attest, approve/reject an
  exception, and export the evidence package now demand a step-up within a 5-min window.
  `sessions.stepped_up_at` records the last re-auth; `POST /api/step-up` re-verifies the
  signed-in user's password (scrypt) and stamps the session; `hasFreshStepUp()` gates the
  three endpoints (`server/src/auth.ts`). Report **viewing** stays open; only **export**
  (`/api/report?export=1`) is gated, and is audit-logged (`report-export`); step-ups are
  audit-logged too. Dev/script callers (`x-user-email`, no session cookie) are exempt.
- **Frontend**: a step-up password modal (`src/components/StepUp.tsx`) the API layer drives
  transparently — a `403 {code:"step_up_required"}` prompts, re-auths, and retries the
  action once (`src/api.ts`); no per-component wiring. Verified end-to-end via curl
  (challenge → wrong pw 401 → correct pw 200 → action succeeds; export gated; header exempt).
## SSO step-up (added this session) — completes step-up for non-local accounts
- **IdP re-auth round-trip** (`server/src/oauth.ts`): `GET /api/auth/step-up` derives the
  provider from the signed-in user's `authProvider`, redirects to the IdP authorize with
  `prompt=login` (forces re-auth; Google honors it, GitHub best-effort), and tags the flow
  via an `oauth_intent` cookie. The shared callback branches on intent: for step-up it
  requires the **same** identity as the active session (mismatch → audit-logged + rejected),
  stamps `stepped_up_at` on the existing session (no new session), and returns to the app
  with `?stepup=ok|mismatch|expired`. Local accounts still use `POST /api/step-up` (password).
- **Frontend**: the step-up modal (`StepUp.tsx`) branches on `me.authProvider` — SSO users
  get a "Re-authenticate with {provider}" button (full-page redirect) instead of a password
  field; App shows a feedback banner on return. `authProvider` now flows through `/api/me`
  + `/api/login`.
- **Verified** (curl, fake provider env + an SSO test user): no-auth → 401, local → 400,
  SSO → 302 to the IdP with `prompt=login` + state/intent cookies. The live token-exchange
  half is operator-tested with a real IdP (as with the original SSO work).

## Still TODO (next increments)
- **SCIM** directory provisioning/deprovisioning + **IdP group→role mapping** — needs a
  real directory (Workspace/Okta). OAuth SSO + JIT provisioning above covers the basics.
- **MyCSF-blocked**: full per-domain-gate r2 scoring over the 19 assessment domains;
  authoritative requirement statements/crosswalks; scoping factor logic. (ISO SoA detail
  could still be built locally.)
- MyCSF ingest/reconciliation layer; scheduled report *delivery* (email/Slack).

## Decisions made autonomously (flag for review)
- Postgres host port 5433 (5432 was taken).
- Matrix groups by the **14 control categories** (real data) since `assessment_domain`
  (the 19 scoring domains) is `tbd` pending MyCSF — honest representation of current data.
- Simplified "current posture" scoring (normalized over attested dimensions); real
  per-domain-gate r2 scoring remains Phase 4.
- Dev auth via `x-user-email` header; client sends `cm@autocomply.local`.
