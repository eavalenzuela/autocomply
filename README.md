# autocomply

A single-org, self-hosted **compliance-automation platform** anchored on
**NIST SP 800-53 Rev 5**, with crosswalks to SOC 2 and ISO 27001. It models the
800-53 catalog as its control set, crosswalks it to external frameworks, and
drives continuous self-assessment from automated evidence — so that the work of
staying audit-ready is mostly maintained by the system rather than by hand.

TypeScript/Node throughout: a **Vite + React** frontend over a **Fastify +
Drizzle + PostgreSQL** backend. The control catalog is generated from the
public-domain NIST OSCAL content (1,196 controls across 20 families / 324 base
controls), with version-controlled YAML for the framework crosswalk
(301 mappings).

> **Status:** working prototype. Every nav section is wired end-to-end on
> bootstrap + simulated data. Live AWS collection and enterprise auth
> (SCIM/MFA/SAML) are intentionally deferred — see
> [Project status](#project-status).

## Features

- **Control matrix** — all 1,196 controls grouped by 800-53 family, with live
  maturity scores, crosswalk badges, and a per-control detail drawer.
- **Attestation + scoring** — append-only attestations across the five PRISMA
  maturity dimensions; normalized weighted scoring with family roll-ups and gates.
- **Evidence store** — immutable, snapshot-hashed evidence with freshness/drift
  tracking.
- **Collectors** — a simulated AWS collector (Check / CheckRun /
  AutomatedFinding → suggested ratings) exercising the real pipeline without
  cloud credentials.
- **Continuous monitoring** — document drift detection, coverage-gap detection,
  and a monitoring scheduler.
- **Exceptions / risk acceptance** — request → approve flow with enforced
  separation of duties (attestor ≠ approver) and expirations.
- **Worklist + notifications** — prioritized, composed task feed (drift,
  coverage gaps, expiring exceptions, AWS confirmations, …).
- **Requirements view + gap report** — reverse crosswalk roll-up giving
  per-requirement coverage and a framework readiness % for SOC 2 / ISO 27001.
- **Auth + admin** — local accounts (scrypt + httpOnly session cookies), 5 roles
  with assignment scoping, a time-boxed auditor role, GitHub/Google OAuth SSO
  with JIT provisioning, and admin pages for users/roles/assignments.
- **Reporting** — auditor evidence package (readiness, coverage, per-control
  evidence, exceptions) with Download-JSON and Print/PDF.

## Architecture

```
src/                 Vite + React + TypeScript frontend (control matrix, drawer,
                     worklist, evidence, requirements, reports, admin)
server/src/          Fastify API
  db/                Drizzle schema + connection
  loader.ts          source-agnostic YAML loader (reads the generated catalog)
  seed.ts            seeds data/*.yaml into Postgres
  scoring.ts         maturity scoring + family gates
  collectors/        simulated AWS collector, doc seeding, monitoring tick
  auth.ts / oauth.ts local sessions, RBAC, GitHub/Google OIDC
data/                controls (generated), frameworks, crosswalk mappings
  vendor/oscal/      vendored NIST 800-53 Rev 5 OSCAL catalog + baselines (CC0)
scripts/             gen_nist_catalog.py (catalog), gen_crosswalk.py (crosswalk)
```

## Getting started

Requires Docker and Node.

```bash
docker compose up -d          # PostgreSQL (host port 5433)
npm install                   # frontend deps
npm install --prefix server   # backend deps
npm run db:setup              # push schema + seed + collect + docs + monitor
npm run dev:all              # web (:5173) + api (:3001)
```

Then open http://localhost:5173 and use the quick-login buttons.

> **Port note:** Postgres is mapped to host **5433** (5432 is commonly taken).
> See `docker-compose.yml` and `server/.env.example`.

### Seeded accounts

All use password `autocomply` (emails `@autocomply.local`):

| Account   | Role               | Notes                              |
|-----------|--------------------|------------------------------------|
| `admin`   | admin              | manage roles + assignments         |
| `cm`      | compliance_manager | approve exceptions                 |
| `owner`   | control_owner      | scoped to assigned controls        |
| `auditor` | auditor            | read-only, time-boxed (30-day)     |
| `viewer`  | viewer             | read-only                          |

Try attesting an unassigned control as the Control Owner to see 403 scoping in
action.

### OAuth SSO (optional)

SSO buttons appear on the login screen only when a provider is configured. Set
credentials in `server/.env` (gitignored) — see `server/.env.example`. First SSO
login JIT-provisions a least-privilege `viewer`; elevate via the local admin
account.

## Project status

Built across the six roadmap phases (see `ROADMAP.md`) at MVP depth:

| Phase | Scope                              | Status                                   |
|-------|------------------------------------|------------------------------------------|
| 0     | Walking skeleton (schema/shell/auth) | Complete                               |
| 1     | Low-baseline self-assessment slice | Core complete (AWS collector simulated)  |
| 2     | Continuous monitoring + remediation | Complete                                |
| 3     | Enterprise auth + admin            | Local + OAuth SSO done; SCIM/MFA/SAML TODO |
| 4     | Full maturity model (all baselines) | Gap report + dashboard done; per-family scoring roll-ups in progress |
| 5     | Reporting + auditor + catalog export | Reporting, auditor role, and GRCen catalog export done |

What runs today does so on **bootstrap and simulated data**. The deferred items
(live AWS credentials, SCIM/MFA/SAML, and broader crosswalk coverage) are
documented in `PROGRESS.md` and `ROADMAP.md`.

## Documentation

- `DESIGN.md` — domain design and entity model
- `REQUIREMENTS.md` — application requirements
- `ROADMAP.md` — phased, dependency-ordered build plan
- `PROGRESS.md` — detailed build log and run checklist

## License

Released into the public domain under [The Unlicense](LICENSE).
