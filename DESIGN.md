# autocomply — Design

A compliance automation tool for **HITRUST CSF (primary)**, **SOC 2 Type II**, and
**ISO 27001**. AWS-first. Single-org / self-hosted (data model kept tenant-aware so a
multi-tenant SaaS pivot later isn't a rewrite). Stack: TypeScript / Node.

> Status: design / brainstorming. No code yet.

## Product thesis

autocomply is a **compliance system-of-record + workflow tool**, where AWS
auto-collection is an *enhancement* that keeps certain evidence fresh — **not** the
engine the product is built around.

"Automatable" here means: a defined repository for evidence, defined processes, and a
tool to manage them — **not** that every step happens without human intervention.
Human-in-the-loop is expected and fine. This framing fits HITRUST, where ~80% of
evidence is inherently human / document / process based.

Build priority follows from this:

1. Grid + evidence linking + freshness tracking (the core).
2. Dependency-aware worklist (the steering wheel).
3. AWS collectors that auto-fill/refresh a subset of cells (the enhancement).

## Architectural keystone: a Common Controls Framework (CCF)

Do **not** build per-framework. Write each test/control **once** against an internal
control, then crosswalk that control to many framework requirements.

```
AWS / evidence  →  Tests  →  Internal Controls  →  Framework Requirements
 (raw facts)     (automated)   (your CCF, ~150)     (SOC2 / ISO / HITRUST)
```

The control→requirement crosswalk (many-to-many) is the product's moat. Anchor the CCF
to HITRUST CSF's structure because HITRUST is itself a *harmonizing* framework — its
authoritative mappings to ISO/SOC2/NIST give the other frameworks' crosswalks largely
for free.

### Crosswalk sourcing

The authoritative HITRUST crosswalks live in **MyCSF** (licensed, not redistributable);
ISO 27001 text is copyrighted; SOC 2 TSC is openly available. Plan:

- Author ~150 internal control **stubs** now, mirroring HITRUST CSF's public
  domain/category structure (no licensed text required).
- Light up **SOC 2 Type II** as the first crosswalk (openly available TSC).
- Ingest HITRUST requirement text + MyCSF crosswalk once we have a subscription. As the
  customer of our own single-org tool, ingesting/referencing MyCSF mappings for our own
  use is fine. No rework — the controls already exist.

## HITRUST specifics that shape the model

- **Assessment tiers differ on TWO independent axes** — requirement *selection* and
  scoring *depth*. This is foundational:

  | Tier | Requirement selection | Scoring depth |
  |------|----------------------|---------------|
  | **e1** (~44)  | static, fixed list | **Implemented dimension only** |
  | **i1** (~182) | static, fixed list | **Implemented dimension only** |
  | **r2** (variable) | **factor-driven (dynamic)** | **full 5-dimension PRISMA maturity** |

- **The 5 PRISMA maturity dimensions apply to r2 only.** e1/i1 assess the *Implemented*
  dimension exclusively — they do not score Policy/Process/Measured/Managed at all.
- **Maturity scoring (r2)** — each requirement is rated across Policy → Process →
  Implemented → Measured → Managed, each dimension graded NC / Somewhat / Partially /
  Mostly / Fully Compliant, weighted into the control/requirement score.
- **Scoping by risk factors applies to r2 only.** e1/i1 scoping is trivial (pick tier →
  canned list). Which r2 requirements (and at which implementation level 1/2/3) apply is
  *computed* from org/system/regulatory factors — needs a scoping engine. See
  [Scoping engine (r2)](#scoping-engine-r2).

### Consequences of the two-axis tier model

- **The grid is r2-shaped.** For e1/i1 the UI collapses to a single Implemented column;
  the other four are N/A, not greyed-out.
- **e1/i1 map almost perfectly onto the AWS-fed column.** The Implemented column *is* the
  automation column → entry/intermediate assessments are where automation ROI is highest;
  r2 is where the human document/process/metric machinery earns its keep.
- Roadmap order follows: **nail e1/i1 (Implemented + AWS automation) first, build out the
  other four columns for r2 second.**

### The pass/fail ↔ maturity mapping (r2)

A test never scores a *requirement* directly. It contributes a signal to **one maturity
dimension** of a control (for r2; for e1/i1 only the Implemented row is in play):

| Dimension   | Primary evidence source                         |
|-------------|-------------------------------------------------|
| Policy      | document evidence (approved policy exists)      |
| Process     | document evidence (documented procedure)        |
| Implemented | **automated AWS tests** (actually configured)   |
| Measured    | metric / operational evidence (KPI tracked)     |
| Managed     | operational evidence (we act on measurements)   |

Consequence: AWS automation realistically lights up **one of five columns**. Document
and operational evidence machinery is co-equal, not a later phase.

## The UI: grid + worklist

**Grid** = visual quick-check map. Rows = controls grouped by domain; columns = the 5
PRISMA dimensions (**r2**). For **e1/i1** the grid collapses to a single Implemented
column. Each cell is a graded **rating** (not a checkbox) plus linked evidence, a
justification note, and a last-reviewed date. AWS-fed cells (almost entirely the
Implemented column) can be *suggested* a rating by a collector; a human confirms it.

```
Domain 01 · Information Protection Program
┌───────────────────────────┬────────┬─────────┬─────────────┬──────────┬─────────┬───────┐
│ Control                    │ Policy │ Process │ Implemented │ Measured │ Managed │ Score │
├───────────────────────────┼────────┼─────────┼─────────────┼──────────┼─────────┼───────┤
│ 01.a Access control policy │  ✔ FC  │  ✔ FC   │   ⚙ auto FC │  ◑ PC    │  ✕ NC   │  72%  │
│   └ 3 docs · refreshed 4d  │ [pol]  │ [proc]  │  AWS:IAM    │ [metric] │   —     │       │
└───────────────────────────┴────────┴─────────┴─────────────┴──────────┴─────────┴───────┘
```

**Worklist** = "what's next" prompter, prioritized. Dependency-aware (a graph, not a
flat sort).

### Worklist prioritization

Dominant principle:

> **Some evidence can only accrue over wall-clock time, and that clock cannot be
> rewound.** Turning on the thing that *starts the clock* (e.g. logging that must show
> 90 days of history) outranks fixing the most-broken control, because the delay is
> irrecoverable.

Priority signals:

1. **Clock-starters** — irrecoverable time lost per day of delay. Highest.
2. **Maturity dependency order** — PRISMA is roughly hierarchical; no Policy → rating
   Process/Implemented/Measured is premature. Unblock upstream dimensions first.
3. **Staleness / drift** — cells about to expire or invalidated by a doc-drift event.
4. **Score leverage** — unrated/low cells that move the weighted roll-up most, esp. just
   under a scoring threshold.
5. **Target-tier gating** — only what's in scope for the assessment being pursued.

Signals 1–2 are graph problems → the worklist engine wants a dependency graph beneath
it, not just a priority number.

## Evidence model

- **Link out, but snapshot + hash.** Each evidence link is
  `{live URL, point-in-time snapshot in our S3, content hash, fetched-at, fetched-by}`.
  The snapshot is the immutable proof tied to a rating; the URL is for humans.
- **Drift is an event.** Re-fetch on a cadence, re-hash; a changed hash spawns a
  **re-attest task**, preserves both snapshot versions, and makes freshness meaningful
  (triggered by the world changing, not only a clock).
- Snapshot **rendered** form (PDF/HTML) for proof + a **text extraction** for diffing.
- **Immutable / append-only store from day one.** Type II and r2 care about operating
  effectiveness *over a period*, so evidence and ratings are append-only timestamped
  records, never overwritten current-state rows. This is what makes "control held 88/90
  days; 2-day gap on Apr 12" computable.

## AWS collection layer — hybrid

Pull from **Security Hub / Config / Audit Manager** where it fits; **custom collectors**
(assume-role + direct API calls: IAM, S3, KMS, CloudTrail, RDS, GuardDuty…) for gaps and
portability. Both flatten into the same normalized evidence schema and feed Implemented
cells via AutomatedFinding.

## Evidence schema (AWS / automated)

### Frame: internal schema + adapters (DECIDED)

A thin **internal evidence schema is the contract**; **adapters** translate ASFF /
AWS Config / OCSF / custom-collector output into it (anti-corruption layer). We do **not**
adopt ASFF or OCSF as our model — ASFF is finding-centric and AWS-proprietary (recouples
us to AWS, which the hybrid decision avoided); OCSF is security-*event*-shaped while our
evidence is mostly "a configuration fact that holds." Borrow OCSF *vocabulary* for cheap
adapters; keep external formats at the boundary (and as a future *export* target).

### Three entities behind automated evidence

`AutomatedFinding` alone is insufficient — automated evidence is really three things
(this also fills the "Tests" box from the CCF diagram, which had no entity):

- **`Check`** — reusable *definition* ("S3 default encryption enabled"): logic, source,
  which control+dimension it feeds (almost always Implemented), and a **rating rubric**.
- **`CheckRun`** — one *execution* across scope at time T: provenance + **completeness**.
- **`AutomatedFinding`** — one *result*, **per resource, per run** (DECIDED). Aggregation
  to a check-level result is a **derived query**, not stored. Auditors want the resource
  list.

```
Check {
  key, title, description
  source_kind: aws-config | security-hub | custom-collector
  collector_ref                       // how to run it
  feeds: [{ control_id, dimension }]   // → Implemented cell(s)
  rating_rubric                        // expression; see below
  applicability                        // when this check is N/A
}
CheckRun {
  check_key, source_id, started_at, finished_at
  status: complete | partial | failed   // load-bearing (see Completeness)
  scope_expected, scope_observed         // resource counts
  collector_version
}
AutomatedFinding {                       // immutable, append-only
  check_run_id, resource_arn, region, account
  result: pass | fail | not_applicable | error | indeterminate
  observed_value, expected_value
  raw_artifact_uri, raw_hash             // immutable proof — parallels Snapshot
  collected_at
}
```

### Completeness: absence of a finding is ambiguous

The subtle, load-bearing point. No `fail` finding on a given day could mean the control
passed, the collector didn't run, or the resource didn't exist yet. We can only honestly
claim period coverage for **days a CheckRun completed successfully**. So `CheckRun.status`
and the `scope_expected` vs `scope_observed` delta are first-class:

- Period coverage = *for each day in the window, was there a `complete` CheckRun whose
  findings all passed?* A `partial`/`failed` run is a **coverage gap**, distinct from a
  control failure.
- A coverage gap spawns a *different* worklist task ("collection broke") than a control
  failure ("control broke"). This is the AWS-side analog of document drift.

### Rating rubric = expression (DECIDED)

The rubric is an **expression** evaluated over a CheckRun's finding set, not a simple
threshold table — because real checks need conditional logic (e.g. "fail if *any* prod
resource fails; ignore non-prod"). It operates over aggregates (`pass_rate`, counts) and
per-resource attributes (tags, environment), and outputs a suggested rating
(NC/SC/PC/MC/FC). Implications:

- Needs a small **sandboxed expression evaluator** (no arbitrary code).
- `not_applicable` findings drop out of the denominator — this is how the AWS layer
  honors scoping (an N/A check shouldn't drag the score down).
- `error`/`indeterminate` findings force "needs human," never a passing rating.
- The output is a *suggestion*; a human confirms it (per the "automatable" definition).

### Symmetry

`AutomatedFinding.{raw_artifact_uri, raw_hash}` exactly parallels
`Snapshot.{s3_uri, content_hash}`. Both are immutable, hashed, timestamped evidence rows
an `Attestation` pins. The two pipelines differ in *production*, converge on the same
immutable-proof shape — which is what keeps the polymorphic `evidence_refs` clean.

## Scoping engine (r2)

r2 scoping does two distinct things, modeled separately:

- **Org + system factors → implementation *level* (1/2/3, cumulative).** Records volume,
  external network exposure, user/interface counts, cloud/mobile usage, etc. push a
  control reference up to its level-2/level-3 requirement statements.
- **Regulatory factors → *overlay* statements.** Selecting HIPAA / PCI / NIST 800-53 /
  state laws / FedRAMP *adds* requirement statements tagged to that regulation, bolted
  onto the baseline.

### Atomic unit: the requirement statement

The in-scope unit is **not** a monolithic requirement. It is a **requirement statement =
`(control reference, implementation level, optional regulatory overlay tag)`**. The
`Requirement` entity decomposes into level-stratified statements, not one clause with an
`impl_level` field.

### Machinery vs. authoritative data (same split as crosswalks)

HITRUST's factor→statement logic is proprietary (lives in MyCSF). We do **not**
reverse-engineer it.

- **Model the machinery now**: a `ScopingProfile` (the org's questionnaire answers) →
  resulting in-scope statement set.
- **Ingest authoritative scoping output from MyCSF** once we have access — MyCSF
  *produces* the scoped list; we consume it.
- **Bootstrap local-rule layer (DECIDED: yes).** A thin, clearly-non-authoritative local
  rule set so the grid feels real pre-subscription. Throwaway-ish; replaced by MyCSF
  ingest.

### Structural decisions

- **Scope is versioned and bound to an AssessmentPeriod.** Adding a system or adopting a
  regulation changes the in-scope set; mid-period changes introduce controls with no
  accrued evidence → straight to the clock-starter worklist. `ScopingProfile` is
  versioned; an `AssessmentPeriod` pins a specific version.
- **Regulatory overlays are first-class objects (DECIDED).** A regulation is both a
  scoping *input* (adds statements) and an output *view* ("show me HIPAA coverage"). It
  is a reusable `RegulatoryOverlay`, not a transient questionnaire answer.
- **Scope flows transitively**: scoped statements → mapped Controls (M:N) → a Control is
  "in play" if ≥1 mapped statement is in scope → its MaturityCells light up (all five for
  r2, Implemented only for e1/i1).

## SOC 2 / ISO 27001 crosswalks

### What we map to

- **SOC 2** → the **Trust Services Criteria**: Security/Common Criteria `CC1–CC9` (33),
  plus opt-in categories Availability/Confidentiality/Processing Integrity/Privacy. The
  *criterion* is the mappable unit; "points of focus" are sub-guidance, not mapped. SOC 2
  isn't a control list — our CCF controls map **to** the criteria.
- **ISO 27001:2022** has **two mappable surfaces**:
  - **Annex A** — 93 controls / 4 themes (Organizational 37, People 8, Physical 14,
    Technological 34). Most CCF technical controls map here.
  - **Clauses 4–10** — the management-system (ISMS) requirements. Mandatory and audited;
    map to CCF categories 00/03/04/05/06, *not* the technical controls. Easy to miss —
    `Requirement.kind` distinguishes `iso-clause` vs `iso-annexa`.
- `RequirementStatement` stays **HITRUST-only** (SOC 2/ISO have no maturity levels);
  `Requirement` alone covers SOC 2 criteria and ISO clauses/controls.

### Sourcing (bootstrap now, MyCSF authoritative later)

- **SOC 2: hand-author now** — TSC is published, no IP blocker. Reference criterion IDs +
  paraphrased intent.
- **ISO: derive via the lineage chain now** — `control → ISO 27002:2005 → (2005→2013→2022
  via ISO 27002:2022 Annex B) → Annex A:2022`. The `iso_2005` refs in `controls.yaml`
  seed this; ~80% derives mechanically. The **11 controls new in 2022** (flagged
  `new_2022` in the framework file) have no ancestor → hand-map.
- Both **reconciled/overridden by MyCSF crosswalk ingest** later (the payoff of
  HITRUST-anchoring).
- **IP boundary**: SOC 2 TSC referenceable; ISO standard text copyrighted → map against
  identifiers + our paraphrase only, never reproduce ISO text.

### Reverse roll-up + gap report

- Crosswalks run **backwards** for readiness: a requirement's status = aggregate over the
  controls mapped to it, weighted by `relationship`. SOC 2/ISO read a **subset** of the
  maturity cells — mostly **Implemented + period coverage** (operating effectiveness),
  with Policy/Process where the criterion demands documentation — not all five.
- **Unmapped requirements are a first-class gap report** (likely ISO clauses 4–10, the
  new-2022 Annex A controls, SOC 2 `CC1`/`CC2` governance) — that's where SOC 2/ISO
  readiness work starts.

### Per-framework scoping artifacts

- **SOC 2**: a **TSC category selection** on the `AssessmentPeriod` (Security always in;
  the rest opt-in).
- **ISO**: the **Statement of Applicability (SoA)** — per Annex A control: applicable
  (y/n) + justification + implemented (y/n). A required ISO deliverable → first-class
  entity, not derived.

### Data

- `data/frameworks/soc2-tsc.yaml` — 61 criteria.
- `data/frameworks/iso27001-2022.yaml` — 30 clauses + 93 Annex A, `new_2022` flags.
- `data/mappings/ccf-crosswalk.yaml` — **full** crosswalk: all 156 controls mapped to
  ISO (162 links), 154 to SOC 2 (186 links); 348 links total, all references validated.
  Generated by `scripts/gen_crosswalk.py` (re-runnable): ISO via the `ISO_TRANSITION`
  lineage table, SOC 2 via the hand-authored `SOC2_MAP`. Each link carries
  relationship/confidence/source.

### Crosswalk gap report (current state)

The reverse view already produces useful gaps — framework requirements with **no** CCF
coverage, exactly as predicted:

- **SOC 2** uncovered: `06.b`/`06.f` (IP rights, crypto regulation) have no SOC 2 nexus;
  criteria `CC1.2, CC5.1, PI1.5, C1.2, P3.2, P6.2–P6.6` lack a technical-control source
  (governance/privacy).
- **ISO** uncovered: the **ISMS clauses** (most of 4–10) — our technical CCF doesn't carry
  the management-system process — and the **new-2022 Annex A controls** with no 2005
  ancestor (`A.5.7, A.5.23, A.7.4, A.8.9–8.12, A.8.16, A.8.23, A.8.28`, etc.). These are
  the hand-mapping / new-control backlog, surfaced automatically.

## Scoring

### Numeric scoring is a HITRUST concern; SOC 2 / ISO are not numeric

The same inputs (cell ratings + coverage) roll up **three different ways** — model
roll-up as a per-framework strategy, *not* one numeric scorer:

- **HITRUST** → weighted **numeric** maturity score (below).
- **SOC 2 Type II** → auditor *opinion*: per-control effective / not, with **exceptions**
  noted over the period. No number.
- **ISO 27001** → *conformity*: major/minor **nonconformities** against the ISMS. No
  number.

### HITRUST r2 formula (bottom-up)

1. **Per requirement statement**, rate each of the 5 maturity levels on NC/SC/PC/MC/FC
   (≈ 0 / 25 / 50 / 75 / 100%), then weight:

   | Level | Weight* |
   |-------|---------|
   | Policy | 15% |
   | Procedure (Process) | 20% |
   | **Implemented** | **40%** |
   | Measured | 10% |
   | Managed | 15% |

   `statement_score = Σ (level_weight × rating%)`. Implemented's 40% makes it the single
   biggest lever — the worklist "score leverage" signal falls straight out of these
   weights.
2. **Domain score** ≈ equal-weighted average of its requirement-statement scores (across
   the 19 assessment domains).
3. **Certification gate is per-domain, not overall** — roughly every one of the 19
   domains must clear ~3.0 on the 1–5 scale. One weak domain blocks certification.
   → scorecard surfaces per-domain status; worklist prioritizes lifting the **lowest
   gate-failing domain** over polishing domains already above the line.

\*Level weights, rating-band percentages, and the %→1–5 conversion are HITRUST-defined;
values here are best-recollection of the published rubric — **confirm against the
official scoring guide / MyCSF** (same disclaimer as crosswalks/scoping).

**e1/i1**: Implemented-only → statement score *is* the Implemented rating; effectively
pass/fail, no maturity weighting.

### Cell granularity (DECIDED: A2)

HITRUST scores per **requirement statement** (each statement scored across all 5 levels),
but our grid cells are per **Control**. Resolution: **`MaturityCell` stays at Control
level** (the human-friendly grid, usable pre-ingest), with a **statement-level scoring
projection underneath** that computes the actual HITRUST score at true granularity once
statements exist (post-MyCSF ingest). Grid ratings roll down to / up from statement
scoring at compute time.

### `Control.weight` is prioritization-only (DECIDED)

HITRUST weights *maturity levels* and averages requirements within a domain equally —
there is **no per-control weight** in the HITRUST method. So `Control.weight` does **not**
feed the score; it is repositioned as a **prioritization weight** (worklist leverage /
drawing attention to controls we care about).

### Two scores, and where coverage lands

- **Current posture score** — roll-up of cells' *current* ratings. Cheap dashboard
  number, not auditable.
- **Period / assessment score** — the auditable one, computed over the timeline within
  `[start, end]`, **coverage-adjusted**.

**Coverage handling = indeterminate-as-NC (DECIDED).** Carrying through "a day with no
successful CheckRun is not a passing day": when coverage over the window falls below a
**configurable threshold**, the maturity level is **indeterminate → scored as NC and
flagged** — auditor-style (insufficient evidence is a finding, not a pass). A coverage
gap stays visibly distinct from a genuine NC: different scorecard annotation, different
worklist task ("collection broke" vs "control broke"), different remediation.

## Entity model

```
  ┌─ CCF / GRID ──────────────────────────────────────────────┐
  │  Domain 1──* Control 1──* MaturityCell 1──* Attestation    │
  │             (~150)        (exactly 5,        (append-only  │
  │                            1 per PRISMA       rating event)│
  │                            dimension)             │ pins   │
  └───────────────────────────────────┬──────────────┼────────┘
                       Mapping (M:N)   │              ▼
  ┌─ FRAMEWORKS ───────────┐           │      ┌─ EVIDENCE ──────────────┐
  │ Framework 1──* Require- │           │      │ Source 1──* Automated-  │
  │   ment ◄───────────────┼───────────┘      │   Finding ─┐            │
  │     ▲  (tier: e1/i1/r2) │  Control↔Req     │            ├─►(evidence │
  │ AssessmentPeriod ──────►│ selects in-scope │ Evidence 1─*Snapshot ─┘ │
  │     ▲                   │ reqs→controls    │     ▲   (immutable cap.)│
  │ ScopingFactors ─────────┘                  │     │                   │
  └─────────────────────────┘     EvidenceAttachment (M:N) ──────────────┘
                                  Evidence/Finding ↔ MaturityCell
  ┌─ WORKFLOW ─────────────────────────────────────────────────┐
  │  Task *──* Task (dependency graph)     Exception ─► Control │
  │   └─► targets a MaturityCell/Control, carries priority+reason│
  └────────────────────────────────────────────────────────────┘
```

| Entity | Key fields | Why it exists |
|---|---|---|
| **ControlCategory** | code (`00`–`13`), title | The 14 CSF control categories — the control *library* parent. |
| **ControlObjective** | code (`01.02`), title, category_id | The 49 control objectives; intermediate library node. |
| **AssessmentDomain** | code (1–19), title | The 19 HITRUST scoring/reporting domains — a regrouping that cuts *across* categories. |
| **Control** | code (`01.a`), title (ours), category_id, objective, **assessment_domain_id**, **weight** (prioritization-only), owner, hitrust_ref? | CCF row. **156**, near-1:1 mirror of HITRUST control references. Framework-agnostic; `hitrust_ref` filled on ingest. `weight` feeds worklist leverage, **not** scoring. Seeded in `data/controls.yaml`. |
| **MaturityCell** | control_id, **dimension**, cached_current_rating, freshness_threshold, auto_source? | Grid cell. Exactly 5 per control (A2: Control-level grid; scoring projects to statement level underneath). `cached_current_rating` is a materialized view of the latest Attestation. |
| **Attestation** | cell_id, **rating** (NC/SC/PC/MC/FC), justification, **evidence_refs[]**, actor, ts, supersedes? | Append-only. The immutable rating history that makes period coverage computable. |
| **Framework** | name, version | SOC2 / ISO27001 / HITRUST CSF |
| **Requirement** | framework_id, code, text, **kind** (hitrust-ref / soc2-criterion / iso-clause / iso-annexa) | A framework clause/criterion/control. HITRUST refs decompose into statements (below); SOC 2/ISO do not. |
| **RequirementStatement** | requirement_id, **impl_level** (1/2/3), overlay_id?, text, **tier_membership** (e1/i1/r2) | The atomic in-scope unit: `(control ref, level, optional overlay)`. Tier membership flags fixed e1/i1 lists vs r2-eligible. |
| **RegulatoryOverlay** | code (HIPAA/PCI/NIST/FedRAMP/…), name | **First-class.** Both a scoping input (adds statements) and a reporting lens. |
| **Mapping** | control_id, requirement_id, **relationship** (equivalent/superset/subset/partial/related), **confidence** (high/med/low), source (manual/lineage-derived/mycsf-ingest), note | The crosswalk. M:N at **Control** level. `relationship` drives the reverse readiness roll-up. |
| **AssessmentPeriod** | framework, tier, start, end, status, scoping_profile_version, **tsc_categories[]** (SOC 2) | The lookback window everything is scored *against*. Pins scope; SOC 2 selects opt-in TSC categories. |
| **SoAEntry** | annexa_control_id, applicable (y/n), justification, implemented (y/n) | ISO Statement of Applicability — required deliverable; first-class, not derived. |
| **ScopingProfile** | **version**, org/system factor answers, selected overlays[], source (mycsf/local-bootstrap) | Versioned questionnaire answers → resolves to an in-scope RequirementStatement set. r2 only. |
| **Source** | type (aws/drive/confluence), config, last_sync | A connected system. |
| **Evidence** | live_url, source_id, kind, owner | The *referenced* doc. Lives elsewhere; we point at it. |
| **Snapshot** | evidence_id, s3_uri, **content_hash**, text_extract_uri, fetched_at, fetched_by, supersedes? | Immutable point-in-time capture. New hash = drift event. |
| **Check** | key, title, source_kind, collector_ref, **feeds[]** (control+dimension), **rating_rubric** (expression), applicability | Reusable test *definition* (the "Tests" box). Almost always feeds Implemented. |
| **CheckRun** | check_key, source_id, started_at, finished_at, **status** (complete/partial/failed), scope_expected, scope_observed, collector_version | One execution; carries **completeness**. A non-`complete` run = coverage gap. |
| **AutomatedFinding** | check_run_id, resource_arn, region, account, **result** (pass/fail/n-a/error/indeterminate), observed/expected_value, **raw_artifact_uri**, **raw_hash**, collected_at | Append-only, **per-resource** result. Aggregation is a derived query. Parallels Snapshot. |
| **EvidenceAttachment** | (Evidence\|Finding) ↔ MaturityCell | M:N join. One policy can back many cells. |
| **Task** | type, target, priority_score, reason, depends_on[], due_at, status | Worklist item; dependency-graph node. |
| **Exception** | control/cell, justification, approver, expires_at | Time-boxed risk acceptance. |

### Load-bearing relationships (settled)

1. **Attestation *pins* specific Snapshot/Finding versions**, never the mutable Evidence
   record. This is the lynchpin: it enables exact "what was in effect when" claims and
   makes drift (a new Snapshot the Attestation didn't pin) the re-attest trigger. Ratings
   reference immutable versions only.
2. **`evidence_refs` is polymorphic: Snapshot *or* AutomatedFinding** — *settled, agreed.*
   Unifies "AWS auto-fills Implemented" with "humans attach docs to the other four" into
   one immutable, hashed, timestamped evidence pipeline. The Implemented cell is not
   special-cased; it just draws mostly from Findings.
3. **The grid is *derived*, the period is the *lens*.** Grid =
   `Control × MaturityCell × cached_current_rating`. Period compliance = a *different*
   query over the Attestation/Finding/Snapshot timeline within `[start, end]`. Rating and
   period-coverage are kept as **separate computations** — a cell can be "FC now" yet
   "covered 80/90 days." This separation is what earns Type II.

### Settled modeling decisions

- **Mapping attaches at Control level** (not MaturityCell). A requirement maps to a
  control; HITRUST maturity is *how* that control is scored.
- **HITRUST requirement score is derived, not stored** — computed over
  Mapping + MaturityCell + Attestation (weighted), so it can't drift from its inputs.
- **Tiers differ on two axes** — selection (e1/i1 static, r2 factor-driven) *and* scoring
  depth (e1/i1 Implemented-only, r2 full 5-dimension). The 5-column grid is r2-shaped.
- **Atomic in-scope unit is the RequirementStatement** `(control ref, level, overlay)`,
  not a monolithic Requirement.
- **Regulatory overlays are first-class objects** (scoping input + reporting lens).
- **Scoping: bootstrap local rules now, ingest authoritative MyCSF scoping later.** Scope
  is versioned and pinned to an AssessmentPeriod.
- **HITRUST has two orthogonal groupings** — the *library* (14 categories → 49
  objectives → 156 control references, codes like `01.a`) and the *scoring lens* (19
  assessment domains, which regroup across categories). The model carries both;
  `Control` belongs to one category+objective and rolls up to one assessment domain.
- **CCF is a near-1:1 mirror of the 156 HITRUST control references** — adopt the `NN.x`
  codes, author our own plain-language titles, map 1:1 to HITRUST on ingest, but keep
  `Control`↔`Requirement` formally separate so SOC2/ISO map cleanly. Stubs generated in
  **`data/controls.yaml`** (categories 01–12 follow ISO 27002:2005 lineage and are solid;
  00/03/13 are HITRUST-specific best-effort; assessment_domain + hitrust_ref + statements
  arrive on MyCSF ingest).
- **Automated evidence = internal schema + adapters** (not ASFF/OCSF as the model).
  Three entities: Check (definition) / CheckRun (execution + completeness) /
  AutomatedFinding (per-resource result, append-only). Aggregation is derived.
- **Completeness is first-class** — only `complete` CheckRuns count toward period
  coverage; a `partial`/`failed` run is a coverage gap (distinct from control failure).
- **Rating rubric is an expression** evaluated over the finding set (needs a sandboxed
  evaluator); N/A drops from the denominator; error/indeterminate force "needs human";
  output is a human-confirmed *suggestion*.
- **Scoring is per-framework, not one scorer** — HITRUST = weighted numeric maturity
  score; SOC 2 = effective/exception status; ISO = conformity/nonconformity. Shared
  inputs, different roll-ups.
- **HITRUST: maturity-level weights** (Implemented heaviest, ~40%), domain score =
  equal-weight average of statement scores, **certification gate is per-domain** (every
  domain must clear the threshold). Exact weights/bands confirmed against MyCSF.
- **Cell granularity = A2** — Control-level grid (human-friendly, pre-ingest usable) +
  statement-level scoring projection underneath (true HITRUST granularity post-ingest).
- **`Control.weight` is prioritization-only**, not a scoring input.
- **Coverage handling = indeterminate-as-NC** — below a configurable coverage threshold
  the level scores as NC and is flagged; gap stays distinct from a genuine NC.
- **Two scores**: current posture (cheap, not auditable) vs period/assessment
  (coverage-adjusted, auditable).
- **ISO 27001 has two mappable surfaces** — Annex A (93 controls) *and* clauses 4–10
  (ISMS); `Requirement.kind` distinguishes. SOC 2 maps to TSC criteria.
- **Crosswalk sourcing**: SOC 2 hand-authored now (TSC published); ISO lineage-derived now
  (27002:2005→2013→2022; 11 new-2022 controls hand-mapped); both overridden by MyCSF.
- **`Mapping` carries relationship + confidence + source** — `relationship` drives the
  reverse readiness roll-up; unmapped requirements are a first-class gap report.
- **SOC 2/ISO read a subset of maturity cells** (mostly Implemented + coverage), not all 5.
- **Per-framework scoping artifacts**: SOC 2 TSC-category selection; ISO Statement of
  Applicability (first-class `SoAEntry`).
- **MyCSF ingest is NOT a build prerequisite** — bootstrap-first by design; build the
  e1/i1 slice now on placeholder data. The required precaution is a **source-agnostic data
  loader** (`data/*.yaml` is the ingest seam); ingest is additive and built last.

## Build readiness — MyCSF ingest is NOT a prerequisite

> **Call-out (decided 2026-05-22): build can start now, without the MyCSF
> ingest/reconciliation layer.** The architecture is bootstrap-first by design, so
> MyCSF is an enhancement that swaps placeholder data for authoritative data — never a
> gate on building or running the system.

**Buildable now, needs nothing from MyCSF:**
- Phase 1 (domain model + schema) — the schema doesn't change based on MyCSF.
- Phase 2 (the e1/i1 vertical slice) — the *least* MyCSF-dependent thing in the design,
  since e1/i1 are Implemented-only (the AWS-fed column). Runs against the 156 control
  stubs we already have.
- Grid, worklist, evidence/snapshot pipeline, attestations, coverage computation — none
  care where control/crosswalk data originated.

**Waits for MyCSF, but not blocking** (each has working non-authoritative placeholder data
today): authoritative requirement-statement text + exact e1/i1/r2 membership; the
authoritative 156→19 assessment-domain mapping; factor→statement scoping logic; confirmed
maturity weights; authoritative crosswalks. You can't produce an *official, submittable r2
score* without these, but you can build/run the whole system and do real e1/i1-style
self-assessment.

### Required precaution: source-agnostic data-loading layer

The one thing that's cheap now and expensive later: **load all control/framework/mapping
data through a loader that does not care whether a row came from our bootstrap or a future
MyCSF sync.** The `data/*.yaml` files are the seam.

- Nothing downstream hard-codes our stub titles or assumes mappings are 1:1.
- The `source` and `confidence` fields on `Mapping` (and `hitrust_ref`/`assessment_domain`
  `tbd`/`null` placeholders, and the `pending_mycsf_ingest` lists) are the reconciliation
  hooks — ingest later is *additive*: it rewrites/augments the same files (or a DB seeded
  from them).
- **Sequence**: build the loader + Phase 1/2 now → design the reconciliation *strategy*
  (merge-without-clobbering-human-work) when MyCSF access is in hand → write the ingester
  last.

## Suggested phased roadmap

1. **Domain model + CCF schema** (HITRUST-anchored control stubs + mapping structure) +
   the **source-agnostic data loader** (reads `data/*.yaml`; the MyCSF-ingest seam).
2. **e1/i1 vertical slice (Implemented column only)** — single AWS source → ~5
   collectors → ~5 tests → controls → fixed e1/i1 statement lists. Highest automation ROI;
   proves the pipeline end to end against the canned tier lists.
3. **Continuous monitoring** — scheduling, re-collection, drift detection.
4. **Findings & remediation workflow** + exceptions / risk acceptance.
5. **r2 build-out** — the other four maturity columns, scoping engine (bootstrap rules →
   MyCSF ingest), regulatory overlays, non-technical/document evidence, maturity scoring.
6. **Reporting** — auditor evidence packages, Type II period support, per-overlay views.
