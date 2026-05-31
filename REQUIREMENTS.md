# autocomply — Application Requirements (user standpoint)

Companion to `DESIGN.md` (which covers the compliance domain model). This doc covers the
**application** users interact with: roles, auth, navigation, admin, and the product's own
security posture. Scope: single-org / self-hosted, TS/Node.

> **Organizing principle — dogfooding.** autocomply is a compliance tool, so it must
> *itself* pass the controls it tracks. SSO, MFA, RBAC, least privilege, separation of
> duties, and immutable audit logging are not just features — they are the CC6 (access),
> CC1 (governance), and HITRUST access-control requirements the product must satisfy to be
> credible. The requirements below double as the product's own control set.

## A. Personas → roles (DECIDED: five roles)

| Role | Who | Core need |
|------|-----|-----------|
| **Org Admin** | IT/security owner | SSO, users, integrations, system settings, MyCSF ingest |
| **Compliance Manager** | GRC lead / program owner | Run programs: scoping, assessment periods, assign owners, approve exceptions, export |
| **Control Owner** | Eng/ops contributors | Work *assigned* controls: attach evidence, set/confirm ratings, clear worklist tasks |
| **Auditor** | External or internal assessor | Read-only over a scoped program/period + evidence-package export + comments; **time-boxed** |
| **Viewer / Exec** | Leadership | Read-only dashboards & scorecards |

## B. RBAC (DECIDED: role + assignment-scoping + separation of duties)

- **Role** grants capability *classes* (what kinds of action).
- **Assignment** scopes *which* controls a user may write to — a Control Owner edits only
  controls assigned to them/their team. Read scope can be broader than write scope.
- **Separation of duties (SoD)** is a first-class, configurable policy and is *enforced* in
  v1: the user who **attests** a control is not the one who **approves its exception**;
  Admin cannot be sole attestor on controls flagged sensitive. SoD is itself a
  HITRUST/SOC 2 control → enforcing it is dogfooding.

Capability × role (✎ write · 👁 read · ✓ approve):

| Capability | Admin | Compliance Mgr | Control Owner | Auditor | Viewer |
|---|:--:|:--:|:--:|:--:|:--:|
| View matrix / scorecards | 👁 | 👁 | 👁 | 👁 (scoped) | 👁 |
| Attest / set rating | ✎ | ✎ | ✎ (assigned) | — | — |
| Attach / link evidence | ✎ | ✎ | ✎ (assigned) | — | — |
| Confirm AWS suggestion | ✎ | ✎ | ✎ (assigned) | — | — |
| Approve exception / risk accept | ✓ | ✓ | — | — | — |
| Scope / assessment periods | ✎ | ✎ | — | — | — |
| Assign owners | ✎ | ✎ | — | — | — |
| Manage integrations | ✎ | — | — | — | — |
| Users / roles / SSO | ✎ | — | — | — | — |
| MyCSF ingest | ✎ | — | — | — | — |
| Export evidence package | ✎ | ✎ | — | ✎ | — |
| View audit log | 👁 | 👁 | — | 👁 (scoped) | — |

SoD enforcement note: "Attest" and "Approve exception" on the same control instance must be
performed by **different** principals; the engine blocks and flags self-approval.

## C. AuthN / SSO (DECIDED: full — SAML + OIDC + SCIM + MFA)

- **SSO**: SAML 2.0 **and** OIDC (Okta, Microsoft Entra/Azure AD, Google Workspace).
- **SCIM 2.0**: auto provision/deprovision + **IdP group → role mapping**. Deprovisioning
  is itself an audited control — a removed employee must lose Control-Owner access.
- **MFA**: enforced (or delegated to the IdP with a policy assertion).
- **Break-glass local admin** account + scoped **API tokens** (CI / automation / collectors).
- **Sessions**: idle timeout + **step-up re-auth** for sensitive actions (attest, approve
  exception, export). Step-up on attestation is what makes an attestation meaningful.

## D. Information architecture — pages & menus

The control matrix (built in `src/`) lives under **Programs**. Top-level nav:

- **Dashboard** — org posture, per-program scorecards, gate status, trends, "what needs me."
- **Programs** — HITRUST r2 / SOC 2 Type II / ISO 27001; each drills into:
  - *Control Matrix* — the built screen.
  - *Requirements view* — by framework requirement: reverse roll-up + **crosswalk gap report**.
  - *Assessment periods* — lifecycle (open/active/closed), pinned scope version.
- **Worklist** — dependency-aware, prioritized tasks (clock-starters first); "my tasks" + team.
- **Evidence** — library: linked docs + snapshots, automated findings, freshness/drift, search.
- **Controls (CCF)** — the 156-control library + crosswalk/mapping management.
- **Risks & Exceptions** — risk acceptances, expirations, approvals.
- **Integrations** — AWS accounts, Okta, doc sources; collector/CheckRun health + coverage.
- **Reports** — auditor evidence packages, scorecards, point-in-time vs period exports.
- **Admin** — users/roles, SSO/SCIM, framework & scoping config, MyCSF ingest/reconciliation,
  notifications, audit log, org settings.

> Note: the implemented screen is the **main view pane only** (the controls page). The
> global nav shell (left nav / app chrome for the sections above) is future work.

## E. Admin functions

Users & roles · SSO/SCIM config · connector management (**assume-role only — no stored
long-lived keys**) · framework/scoping configuration · **MyCSF ingest & reconciliation**
(the additive, non-clobbering merge from `DESIGN.md`) · assessment-period lifecycle ·
notification rules · API tokens & webhooks · data retention/export · audit-log review.

## F. Cross-cutting

Global search (⌘K) · notifications (email/Slack: "control went stale," "coverage gap
opened," "exception expiring") · comments/@mentions on controls & evidence · bulk actions ·
the app's **own immutable audit log** (distinct from compliance evidence) · read API for
matrix data.

## G. Auditor access (DECIDED: time-boxed read-only role)

Dedicated **Auditor** role, scoped to a single program/period, **auto-expiring**, with
evidence-package export + comment rights. Cleanest and most auditable (vs. out-of-band
package sharing). Standalone export packages remain available to Compliance Managers but
are not the auditor's primary path.

## H. Non-functional / the product's own security posture

Because of the dogfooding principle, these are requirements, not nice-to-haves:

- Encryption in transit (TLS) and at rest; secrets via a manager, never in DB/code.
- Connector creds = **assume-role / short-lived**, never stored long-lived AWS keys.
- Immutable, append-only **audit log** + immutable **evidence store** (per `DESIGN.md`).
- Least privilege + SoD (Sections B/C) applied to the product's own access.
- Backups + tested restore; data export on demand.
- **Tenant-aware data model** even though single-org now (per the deployment decision), so
  a future multi-tenant pivot isn't a rewrite.

## Settled decisions

- **Five roles**: Admin / Compliance Manager / Control Owner / Auditor / Viewer.
- **RBAC = role + assignment-scoping + enforced SoD** (attestor ≠ exception approver).
- **Auth = full**: SAML + OIDC SSO, SCIM provisioning + group→role mapping, enforced MFA,
  step-up re-auth, break-glass admin, scoped API tokens.
- **Auditor = time-boxed read-only role**, scoped + auto-expiring, with export + comments.
- **Dogfooding principle**: the product must satisfy the controls it tracks; NFRs in §H are
  binding.
