# Planned improvements + features (2026-07-03)

Concrete, repo-specific work items for this pass, verified against the current
code before planning. Improvements target existing behavior/robustness/perf/UX/
tests; features add new capability. All land in one commit on `main`.

## Improvements

1. **Latest-attestation query via Postgres `DISTINCT ON`** — `latestAttestations()`
   pulls the entire append-only attestations table and dedupes in JS on every
   matrix/worklist/report/notifications request; one `selectDistinctOn` scan does
   it in the database.
2. **Parallelize `/api/control/:code`** — the drawer detail endpoint runs four
   sequential queries; the last three are independent and belong in a `Promise.all`.
3. **Validate referenced entities on write endpoints** — `/api/attest`,
   `/api/exception`, and `/api/assign` insert unchecked control codes / user ids,
   so a typo surfaces as a Postgres FK-violation 500; return a clean 404/400 instead.
4. **Harden assessment-period endpoints** — `/api/periods` accepts unparseable
   dates, end-before-start ranges, and unknown frameworks/tiers; validate all of
   it, 404 unknown period ids, and audit-log status transitions (create is logged,
   status change silently isn't).
5. **Real health check** — `/api/health` always says ok; ping the DB and report
   `{ ok, db, latencyMs }` with a 503 when Postgres is unreachable, so the deploy
   stack's probes mean something.
6. **Memory/DB hygiene for auth state** — the in-memory rate-limit buckets grow
   unboundedly per client IP and expired session rows are never deleted; extract
   the limiter to its own module with pruning and sweep expired sessions on a
   server interval.
7. **Route all frontend reads through the step-up-aware `request` wrapper** —
   worklist/evidence/exceptions/requirements/notifications/control-detail use bare
   `fetch` (no `credentials`, no step-up retry, inconsistent error text) while the
   rest of `api.ts` uses the shared wrapper.
8. **Render the control's evidence in the Drawer** — `/api/control/:code` already
   ships the evidence rows and the client types them, but the Drawer never displays
   them; show title/kind/hash/drift with the live-source link (and fix the history
   dot-status class that never matched its CSS — the status class must sit on the
   row, not the dot).
9. **Free-text attestation justification in the Drawer** — every UI attestation
   writes the hardcoded string `Manual attestation (dim)`, which makes the
   append-only audit trail useless; add a justification field.
10. **Unit tests that run without Postgres** — the only test file is a DB-backed
    integration suite; add pure unit tests for the scoring engine and the rate
    limiter plus a `test:unit` script (and stop dropping the catalog-export warning
    on the disabled Fastify logger).

## New features

1. **Exception auto-expiry** — the schema documents an `expired` status that
   nothing ever sets; the monitor tick now flips approved-and-lapsed risk
   acceptances to `expired`, audit-logs and webhooks the transition, and the
   worklist/notifications surface the lapses as remediation tasks.
2. **Admin audit-log viewer** — `GET /api/audit` (admin/auditor; paginated, action
   filter) plus an Audit log panel on the Admin page: the roadmap Phase-3
   "audit-log review" affordance for an append-only log that today is only writable.
3. **Request-exception flow in the UI** — `POST /api/exception` has existed since
   P2 with no UI path; add a Drawer form so writers can file a risk-acceptance
   request (reason + optional expiry) against the open control.
4. **SoA CSV export** — assessors expect the ISO 27001 Statement of Applicability
   as a document; add a Download-CSV button exporting code/title/theme/
   applicability/status/justification/coverage for all Annex A entries.
5. **Local-account password change** — `POST /api/me/password` (verifies the
   current password, enforces a minimum length, rate-limited, audit-logged, revokes
   the user's other sessions) plus a topbar-launched modal for local accounts.
