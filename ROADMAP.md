# autocomply — Phased Roadmap

Merges the **domain** roadmap (`DESIGN.md`) and the **application** requirements
(`REQUIREMENTS.md`) into one dependency-ordered sequence. Single-org / self-hosted,
TS/Node.

## Throughlines

1. **Vertical slices, value early** — each phase is independently demoable, not a
   horizontal layer.
2. **e1/i1 before r2, MyCSF last** — highest-automation-ROI slice (Implemented-only =
   the AWS-fed column) ships first; authoritative MyCSF ingestion ships last. (Per the
   `DESIGN.md` build-readiness call-out: MyCSF is not a build prerequisite.)
3. **Dogfooding is a phase** — the product's own SSO/MFA/SoD posture gets a dedicated
   hardening pass (Phase 3), satisfying the controls it tracks.

## Status going in

- Done: domain design (`DESIGN.md`), app requirements (`REQUIREMENTS.md`), framework +
  crosswalk data (`data/*`, `scripts/gen_crosswalk.py`), and the **control-matrix UI
  pane** (`src/`, Vite+React+TS) running on mock data.
- Not yet built: any backend/persistence, the global nav shell, auth.

---

## Phase 0 — Walking skeleton (foundations)

**Goal:** real users see real data in a navigable app.

- Persistence + the `DESIGN.md` entity schema.
- **Source-agnostic data loader** seeding `data/*.yaml` into the DB (the MyCSF-ingest seam).
- **Global nav shell** (chrome for Dashboard/Programs/Worklist/… that the built matrix pane
  plugs into) + routing.
- Wire the existing control-matrix UI to **backend data** (the 156 controls) — replace
  `src/data.ts` mock.
- Baseline auth: local accounts + sessions; the **5 roles + assignment-scoping** defined and
  gating writes. Append-only **audit-log** skeleton.

**Exit:** log in → see the real 156-control matrix from the DB → navigate (stub) sections.

## Phase 1 — e1/i1 vertical slice (first real value)

**Goal:** an end-to-end Implemented-dimension self-assessment against AWS.

- Immutable **evidence store** (link-out + snapshot + hash) + freshness tracking.
- **Attestation flow** on the Implemented cell (set/confirm rating), scoped to assigned
  owners; the detail drawer wired live.
- **AWS collectors** (hybrid: Security Hub / Config + a few custom) → Check / CheckRun /
  AutomatedFinding; **completeness tracking**; rubric → suggested rating.
- **Worklist v1** (staleness + clock-starter signals).

**Exit:** a Control Owner runs an e1/i1-style self-assessment end to end on the Implemented
dimension, with immutable evidence + coverage.

## Phase 2 — Continuous monitoring + remediation

**Goal:** the system self-maintains.

- Scheduling / re-collection; **drift detection** (doc hash change → re-attest task);
  coverage-gap tasks.
- **Findings / remediation** workflow; **exceptions / risk acceptance with enforced SoD**
  (attestor ≠ approver) + expirations.
- Notifications (stale / coverage-gap / exception-expiring); **Worklist v2** (dependency
  graph + full priority composition).

**Exit:** drift and coverage gaps surface as prioritized work; exceptions flow with
separation of duties.

## Phase 3 — Enterprise auth + admin (dogfooding hardening)

**Goal:** production-grade access; the product passes its own CC6.

- Full **SSO (SAML + OIDC)**, **SCIM** provisioning + IdP group→role mapping, enforced
  **MFA**, **step-up re-auth** on attest/approve/export, scoped API tokens.
- **Admin pages**: users/roles, SSO/SCIM config, integration management, notification rules,
  audit-log review.

**Exit:** the product satisfies its own access-control controls.

> **Sequencing note (the one debatable call):** SSO/SCIM is placed here, after the domain
> value (Phases 1–2), with **local accounts first in Phase 0**. Rationale: for single-org
> self-hosted dev, local accounts + role/scoping suffice to build/demo everything; full
> SSO is a hardening pass before real org rollout. Pull SSO into Phase 0 instead if early
> real-org/multi-user use is intended.

## Phase 4 — r2 build-out (full maturity model)

**Goal:** full HITRUST r2 assessment on bootstrap data.

- The other four maturity columns (Policy / Process / Measured / Managed) — **document &
  operational evidence as first-class**.
- **Scoping engine** (bootstrap local rules → factor profile → in-scope statements) +
  regulatory overlays.
- **Maturity scoring** (weighted; per-domain certification gate; A2 statement-level
  projection).
- **Requirements view + crosswalk gap report** UI.

**Exit:** full r2 assessment on bootstrap data; per-domain gates computed.

## Phase 5 — Reporting + auditor + MyCSF (audit-ready)

**Goal:** ready for a real external assessment with authoritative data.

- Reporting / **evidence packages**; point-in-time vs period (Type II); per-overlay views.
- **Time-boxed auditor role** (scoped, auto-expiring, export + comments).
- **MyCSF ingest & reconciliation** (additive, non-clobbering merge) — last.

**Exit:** ready for a real external assessment with authoritative HITRUST data.

---

## Dependency summary

```
P0 foundations ──┬─► P1 e1/i1 slice ──► P2 monitoring+remediation ──► P4 r2 build-out ──► P5 reporting+auditor+MyCSF
                 └─► P3 enterprise auth+admin  (can run parallel to P1–P2; gates real-org rollout)
```

- P0 blocks everything (schema, loader, shell, auth baseline).
- P1 is the recommended first value slice; P2 extends it.
- P3 (auth hardening) can proceed in parallel with P1–P2 and is the gate for real-org use.
- P4 needs P1's evidence/attestation machinery; P5 needs P4's scoring + P2's exceptions.
- MyCSF ingest is intentionally last; bootstrap data carries P0–P4.
