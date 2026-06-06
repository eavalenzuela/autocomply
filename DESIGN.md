# autocomply — Design

A compliance automation tool for **NIST SP 800-53 Rev 5 (primary)**, **SOC 2 Type II**, and
**ISO 27001**. AWS-first. Single-org / self-hosted (data model kept tenant-aware so a
multi-tenant SaaS pivot later isn't a rewrite). Stack: TypeScript / Node.

> Status: design / brainstorming. No code yet.

## Product thesis

autocomply is a **compliance system-of-record + workflow tool**, where AWS
auto-collection is an *enhancement* that keeps certain evidence fresh — **not** the
engine the product is built around.

"Automatable" here means: a defined repository for evidence, defined processes, and a
tool to manage them — **not** that every step happens without human intervention.
Human-in-the-loop is expected and fine. This framing fits 800-53, where ~80% of
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
 (raw facts)     (automated)   (your CCF, ~1196)    (SOC2 / ISO / 800-53)
```

The control→requirement crosswalk (many-to-many) is the product's moat. The control
spine **is** the NIST SP 800-53 Rev 5 catalog: 800-53 is itself a *harmonizing* baseline
framework — its public OLIR mappings to ISO/SOC2 give the other frameworks' crosswalks
largely for free, and its content is public-domain (no IP blocker on shipping it).

### Crosswalk sourcing

The 800-53 control catalog is **public-domain** (NIST OSCAL content, CC0), so it ships
directly; ISO 27001 text is copyrighted; SOC 2 TSC is openly available. Plan:

- The control spine is **generated** from the vendored NIST OSCAL catalog — 20 families
  → 324 base controls → 1196 controls (base + enhancements). No stub authoring required.
- Light up **SOC 2 Type II** as the first crosswalk (openly available TSC).
- ISO mappings derive from the published **NIST 800-53r5 ↔ ISO/IEC 27001:2022 OLIR**
  informative reference (identifiers only). No rework — the controls already exist.

## NIST 800-53 specifics that shape the model

- **Baselines select controls; the maturity model scores them — two independent axes.**
  800-53 ships three cumulative baselines (Low ⊂ Moderate ⊂ High); every baseline is
  assessed across the **full 5-dimension PRISMA maturity model**.

  | Baseline | Control selection | Scoring depth |
  |----------|-------------------|---------------|
  | **Low** (149)      | OSCAL baseline profile | full 5-dimension PRISMA maturity |
  | **Moderate** (287) | OSCAL baseline profile | full 5-dimension PRISMA maturity |
  | **High** (370)     | OSCAL baseline profile | full 5-dimension PRISMA maturity |

- **The 5 PRISMA maturity dimensions (NIST IR 7358) apply to every baseline.** Selection
  narrows *which* controls are in scope; it never narrows the dimensions scored.
- **Maturity scoring** — each control is rated across Policy → Process → Implemented →
  Measured → Managed, each dimension graded NC / Somewhat / Partially / Mostly / Fully
  Compliant, weighted into the control score.
- **Baseline membership is data, not computed.** Which controls are in scope is read
  directly from the three OSCAL baseline profile JSONs into a `controlBaselines` join
  table — no risk-factor scoping engine. See [Baselines](#baselines).

### Consequences of the baseline + maturity model

- **The grid is always 5-column.** Every in-scope control is rated across all five PRISMA
  dimensions, regardless of baseline.
- **The Implemented column maps almost perfectly onto the AWS-fed column.** The
  Implemented dimension *is* the automation column → that's where automation ROI is
  highest; the other four are where the human document/process/metric machinery earns its
  keep.
- Roadmap order follows: **nail the Implemented column (AWS automation) first, build out
  the other four columns second.**

### The pass/fail ↔ maturity mapping

A test never scores a *control's framework requirement* directly. It contributes a signal
to **one maturity dimension** of a control:

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

**Grid** = visual quick-check map. Rows = controls grouped by family; columns = the 5
PRISMA dimensions. Each cell is a graded **rating** (not a checkbox) plus linked evidence, a
justification note, and a last-reviewed date. AWS-fed cells (almost entirely the
Implemented column) can be *suggested* a rating by a collector; a human confirms it.

```
AC · Access Control
┌───────────────────────────┬────────┬─────────┬─────────────┬──────────┬─────────┬───────┐
│ Control                    │ Policy │ Process │ Implemented │ Measured │ Managed │ Score │
├───────────────────────────┼────────┼─────────┼─────────────┼──────────┼─────────┼───────┤
│ AC-2 Account Management    │  ✔ FC  │  ✔ FC   │   ⚙ auto FC │  ◑ PC    │  ✕ NC   │  72%  │
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
5. **Target-baseline gating** — only what's in scope for the baseline being pursued.

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
- **Immutable / append-only store from day one.** Type II and period maturity assessment
  care about operating effectiveness *over a period*, so evidence and ratings are append-only timestamped
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

## Baselines

Control selection is **data, not a computed scoping engine.** 800-53 ships three
cumulative baselines as OSCAL profile JSONs; we read membership directly:

- **Baseline membership is read from the OSCAL baseline profiles.** The three profile
  JSONs (Low / Moderate / High) enumerate exactly which controls each baseline includes;
  the generator loads them into a `controlBaselines(controlCode, baseline)` join table.
- **Baselines are cumulative supersets.** Low (149) ⊂ Moderate (287) ⊂ High (370). A
  control is "in play" for a baseline iff it appears in that baseline's profile.

### The in-scope unit is the control

The in-scope unit is the **control** (base control or enhancement, code form `AC-2(1)`).
There is no level-stratified or overlay-tagged requirement statement — selection is a
flat membership test against the chosen baseline.

### Provenance

The 800-53 catalog and its baselines are **public-domain** (NIST OSCAL content, CC0), so
there is no authoritative-data licensing seam to ingest later — `data/controls.yaml` is
generated from the vendored OSCAL catalog by `scripts/gen_nist_catalog.py`, and baseline
membership comes from the OSCAL baseline profiles in the same generation step.

### Structural decisions

- **Baseline is bound to an AssessmentPeriod.** An `AssessmentPeriod` pins one of
  `low|moderate|high`; the in-scope control set follows from `controlBaselines`. Adding a
  control to scope mid-period (e.g. moving Moderate → High) introduces controls with no
  accrued evidence → straight to the clock-starter worklist.
- **Scope flows directly**: a Control is "in play" if it is a member of the period's
  baseline → its MaturityCells light up (all five dimensions, for every baseline).

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
    map to 800-53 program-management / governance families (PM, PL, CA, AC, AU), *not*
    the technical controls. Easy to miss — `Requirement.kind` distinguishes `iso-clause`
    vs `iso-annexa`.
- The crosswalk maps 800-53 **base control codes** to SOC 2 criteria and ISO
  clauses/controls; `Requirement` alone covers SOC 2 criteria and ISO clauses/controls.

### Sourcing

- **SOC 2: hand-authored** — TSC is published, no IP blocker. Reference criterion IDs +
  paraphrased intent (`SOC2_MAP` in the generator).
- **ISO: OLIR (authoritative)** — the published **NIST 800-53r5 ↔ ISO/IEC 27001:2022**
  informative reference maps controls (base **and** enhancements) → Annex A / clause
  (identifiers only). Vendored under `data/vendor/olir/` and extracted by
  `scripts/extract_olir.py`. The submission is set-based, so untyped pairs default to
  `related`/medium; an `ISO_OVERRIDE` table upgrades well-known direct matches and adds the
  few pairs OLIR omits. Controls with no OLIR counterpart fall into the gap report.
- The **ISO side is authoritative** (NIST OLIR); the **SOC 2 side is a hand-authored
  bootstrap**, as are the remaining unmapped controls. Every link carries
  confidence/source so it can be refined.
- **IP boundary**: 800-53 catalog is public-domain; SOC 2 TSC referenceable; ISO standard
  text copyrighted → map against identifiers + our paraphrase only, never reproduce ISO
  text.

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
- `data/mappings/ccf-crosswalk.yaml` — crosswalk keyed on 800-53 control codes (base +
  enhancements), generated by `scripts/gen_crosswalk.py` (re-runnable): **ISO from the
  authoritative NIST OLIR** mapping (~692 links over 197 base controls + 48 enhancements),
  SOC 2 via the hand-authored `SOC2_MAP` (~188 links over 160 base controls). Each link carries
  relationship/confidence/source; unmapped controls land in the gap report.

### Crosswalk gap report (current state)

The reverse view already produces useful gaps — framework requirements with **no** CCF
coverage, exactly as predicted:

- **SOC 2** uncovered: criteria `CC1.2, CC5.1, PI1.5, C1.2, P3.2, P6.2–P6.6` lack a
  technical-control source (governance/privacy) — and 800-53 base controls with no SOC 2
  nexus surface as unmapped on the other side.
- **ISO** uncovered: the **ISMS clauses** (most of 4–10) — our technical control spine
  doesn't carry the management-system process — and any **new-2022 Annex A controls** with
  no OLIR counterpart (`A.5.7, A.5.23, A.7.4, A.8.9–8.12, A.8.16, A.8.23, A.8.28`, etc.).
  These are the hand-mapping / new-control backlog, surfaced automatically.

## Scoring

### Numeric maturity scoring; SOC 2 / ISO are not numeric

The same inputs (cell ratings + coverage) roll up **three different ways** — model
roll-up as a per-framework strategy, *not* one numeric scorer:

- **NIST 800-53** → weighted **numeric** PRISMA maturity score (below).
- **SOC 2 Type II** → auditor *opinion*: per-control effective / not, with **exceptions**
  noted over the period. No number.
- **ISO 27001** → *conformity*: major/minor **nonconformities** against the ISMS. No
  number.

### Maturity formula (bottom-up)

1. **Per control**, rate each of the 5 PRISMA maturity levels on NC/SC/PC/MC/FC
   (≈ 0 / 25 / 50 / 75 / 100%), then weight:

   | Level | Weight |
   |-------|---------|
   | Policy | 15% |
   | Procedure (Process) | 20% |
   | **Implemented** | **40%** |
   | Measured | 10% |
   | Managed | 15% |

   `control_score = Σ (level_weight × rating%)`. Implemented's 40% makes it the single
   biggest lever — the worklist "score leverage" signal falls straight out of these
   weights.
2. **Family score** ≈ equal-weighted average of its control scores (across the 20 control
   families).
3. **Gate is per-family, not overall** — roughly every one of the 20 families must clear
   ~3.0 on the 0–5 scale. One weak family fails the assessment.
   → scorecard surfaces per-family status; worklist prioritizes lifting the **lowest
   gate-failing family** over polishing families already above the line.

The level weights and rating-band percentages are the PRISMA maturity model (NIST IR
7358 lineage); the rating scale (nc/sc/pc/mc/fc) and gate thresholds live in
`scoring.ts`.

### Cell granularity

Maturity is scored per **control** (each scored across all 5 levels), which is exactly the
grain of the grid: `MaturityCell` is at Control level, one cell per PRISMA dimension. No
projection layer is needed — the in-scope unit and the scoring unit are the same Control.

### `Control.weight` is prioritization-only (DECIDED)

The PRISMA method weights *maturity levels* and averages controls within a family equally
— there is **no per-control weight** in the scoring method. So `Control.weight` does
**not** feed the score; it is repositioned as a **prioritization weight** (worklist
leverage / drawing attention to controls we care about).

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
  │  Family 1──* Control 1──* MaturityCell 1──* Attestation    │
  │   (20)       (1196)       (exactly 5,        (append-only  │
  │                            1 per PRISMA       rating event)│
  │                            dimension)             │ pins   │
  └───────────────────────────────────┬──────────────┼────────┘
                       Mapping (M:N)   │              ▼
  ┌─ FRAMEWORKS ───────────┐           │      ┌─ EVIDENCE ──────────────┐
  │ Framework 1──* Require- │           │      │ Source 1──* Automated-  │
  │   ment ◄───────────────┼───────────┘      │   Finding ─┐            │
  │     ▲  (soc2 / iso)     │  Control↔Req     │            ├─►(evidence │
  │ AssessmentPeriod ──────►│ selects in-scope │ Evidence 1─*Snapshot ─┘ │
  │     ▲ (baseline)        │ reqs→controls    │     ▲   (immutable cap.)│
  │ ControlBaseline ────────┘                  │     │                   │
  └─────────────────────────┘     EvidenceAttachment (M:N) ──────────────┘
                                  Evidence/Finding ↔ MaturityCell
  ┌─ WORKFLOW ─────────────────────────────────────────────────┐
  │  Task *──* Task (dependency graph)     Exception ─► Control │
  │   └─► targets a MaturityCell/Control, carries priority+reason│
  └────────────────────────────────────────────────────────────┘
```

| Entity | Key fields | Why it exists |
|---|---|---|
| **ControlCategory** | code (`AC`, `AU`, …), title | The 20 control families — the 800-53 control *library* parent (`category` in the taxonomy). |
| **ControlObjective** | code (`AC-1`, `AC-2`, …), title, category_id | The 324 base controls; intermediate library node (`objective` in the taxonomy). |
| **Control** | code (`AC-2(1)`), title, category_id, objective, **weight** (prioritization-only), owner | CCF row. **1196** (base controls + enhancements), generated from the NIST OSCAL catalog. Framework-agnostic. `weight` feeds worklist leverage, **not** scoring. Seeded in `data/controls.yaml`. |
| **ControlBaseline** | control_code, **baseline** (low/moderate/high) | Join table: which controls each cumulative baseline includes. Read from the three OSCAL baseline profile JSONs. |
| **MaturityCell** | control_id, **dimension**, cached_current_rating, freshness_threshold, auto_source? | Grid cell. Exactly 5 per control, 1 per PRISMA dimension. `cached_current_rating` is a materialized view of the latest Attestation. |
| **Attestation** | cell_id, **rating** (NC/SC/PC/MC/FC), justification, **evidence_refs[]**, actor, ts, supersedes? | Append-only. The immutable rating history that makes period coverage computable. |
| **Framework** | name, version | SOC2 / ISO27001 (crosswalk targets) |
| **Requirement** | framework_id, code, text, **kind** (soc2-criterion / iso-clause / iso-annexa) | A framework clause/criterion/control that 800-53 controls map *to*. |
| **Mapping** | control_id, requirement_id, **relationship** (equivalent/superset/subset/partial/related), **confidence** (high/med/low), source (manual/olir-derived), note | The crosswalk. M:N at **Control** level (keyed on base control codes). `relationship` drives the reverse readiness roll-up. |
| **AssessmentPeriod** | **framework** (nist80053/soc2/iso27001), **tier** (low/moderate/high), start, end, status, **tsc_categories[]** (SOC 2) | The lookback window everything is scored *against*. `tier` pins the 800-53 baseline; SOC 2 selects opt-in TSC categories. |
| **SoAEntry** | annexa_control_id, applicable (y/n), justification, implemented (y/n) | ISO Statement of Applicability — required deliverable; first-class, not derived. |
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
  control; PRISMA maturity is *how* that control is scored.
- **Framework requirement score is derived, not stored** — computed over
  Mapping + MaturityCell + Attestation (weighted), so it can't drift from its inputs.
- **Baselines select; maturity scores** — selection (Low/Moderate/High membership) is a
  flat data lookup; every in-scope control is scored across the full 5-dimension grid.
- **In-scope unit is the Control** (base control or enhancement, code `AC-2(1)`), a flat
  membership test against the chosen baseline — no level-stratified statements.
- **Baseline is pinned to an AssessmentPeriod** via `tier` (low/moderate/high); the
  in-scope set follows from `controlBaselines`.
- **Three-level taxonomy** — the control spine is the *library* (20 families → 324 base
  controls → 1196 controls incl. enhancements): `category` = family, `objective` = base
  control, `control` = base control + each enhancement. There is no separate scoring lens
  — gating groups by the 20 families directly.
- **CCF *is* the 800-53 catalog** — generated from the public-domain NIST OSCAL content
  (CC0) vendored under `data/vendor/oscal/`; `data/controls.yaml` is produced by
  `scripts/gen_nist_catalog.py`. `Control`↔`Requirement` stays formally separate so
  SOC2/ISO map cleanly.
- **Automated evidence = internal schema + adapters** (not ASFF/OCSF as the model).
  Three entities: Check (definition) / CheckRun (execution + completeness) /
  AutomatedFinding (per-resource result, append-only). Aggregation is derived.
- **Completeness is first-class** — only `complete` CheckRuns count toward period
  coverage; a `partial`/`failed` run is a coverage gap (distinct from control failure).
- **Rating rubric is an expression** evaluated over the finding set (needs a sandboxed
  evaluator); N/A drops from the denominator; error/indeterminate force "needs human";
  output is a human-confirmed *suggestion*.
- **Scoring is per-framework, not one scorer** — 800-53 = weighted numeric PRISMA maturity
  score; SOC 2 = effective/exception status; ISO = conformity/nonconformity. Shared
  inputs, different roll-ups.
- **PRISMA maturity-level weights** (Implemented heaviest, ~40%), family score =
  equal-weight average of control scores, **gate is per-family** (every one of the 20
  families must clear the threshold). Weights/scale live in `scoring.ts`.
- **Cell granularity** — Control-level grid, scored per control across 5 dimensions; the
  in-scope unit and the scoring unit are the same Control (no projection layer).
- **`Control.weight` is prioritization-only**, not a scoring input.
- **Coverage handling = indeterminate-as-NC** — below a configurable coverage threshold
  the level scores as NC and is flagged; gap stays distinct from a genuine NC.
- **Two scores**: current posture (cheap, not auditable) vs period/assessment
  (coverage-adjusted, auditable).
- **ISO 27001 has two mappable surfaces** — Annex A (93 controls) *and* clauses 4–10
  (ISMS); `Requirement.kind` distinguishes. SOC 2 maps to TSC criteria.
- **Crosswalk sourcing**: ISO from the authoritative NIST OLIR mapping (800-53r5 ↔
  ISO 27001:2022, codes only); SOC 2 hand-authored (TSC published) + gap report.
- **`Mapping` carries relationship + confidence + source** — `relationship` drives the
  reverse readiness roll-up; unmapped requirements are a first-class gap report.
- **SOC 2/ISO read a subset of maturity cells** (mostly Implemented + coverage), not all 5.
- **Per-framework scoping artifacts**: SOC 2 TSC-category selection; ISO Statement of
  Applicability (first-class `SoAEntry`).
- **Control/framework data loads through a source-agnostic loader** — `data/*.yaml` is the
  seam; `controls.yaml` is generated from the NIST OSCAL catalog, crosswalk from the
  generator, so downstream code never hard-codes provenance.

## Build readiness

> **The architecture is generation-driven**: the control spine and crosswalk are produced
> from public-domain NIST OSCAL content and re-runnable generator scripts — there is no
> proprietary-data ingest gate on building or running the system.

**Buildable now:**
- Phase 1 (domain model + schema) — fully specified against the generated 800-53 catalog.
- Phase 2 (the Implemented-column vertical slice) — the AWS-fed column. Runs against the
  1196 controls generated from the OSCAL catalog.
- Grid, worklist, evidence/snapshot pipeline, attestations, coverage computation — none
  care where control/crosswalk data originated.

**Refinement backlog, not blocking** (each has working data today): the ISO crosswalk is
authoritative (NIST OLIR), while the SOC 2 side is a hand-authored bootstrap, both with a
gap report for unmapped controls; non-technical/document
evidence machinery for the Policy/Process/Measured/Managed columns. You can build/run the
whole system and do real maturity self-assessment against any 800-53 baseline today.

### Required precaution: source-agnostic data-loading layer

The one thing that's cheap now and expensive later: **load all control/framework/mapping
data through a loader that does not care whether a row came from a generator run or a
hand-edit.** The `data/*.yaml` files are the seam.

- Nothing downstream hard-codes titles or assumes mappings are 1:1.
- The `source` and `confidence` fields on `Mapping` are the reconciliation hooks — a
  re-run of `gen_nist_catalog.py` / `gen_crosswalk.py` is *additive*: it regenerates the
  same files (or a DB seeded from them) without clobbering hand-authored overrides.
- **Sequence**: build the loader + Phase 1/2 now → refine the crosswalk gap report as
  hand-mappings land.

## Suggested phased roadmap

1. **Domain model + schema** (the generated 800-53 control spine + mapping structure) +
   the **source-agnostic data loader** (reads `data/*.yaml`, generated from NIST OSCAL).
2. **Implemented-column vertical slice** — single AWS source → ~5 collectors → ~5 tests →
   controls. Highest automation ROI; proves the pipeline end to end against the Moderate
   baseline.
3. **Continuous monitoring** — scheduling, re-collection, drift detection.
4. **Findings & remediation workflow** + exceptions / risk acceptance.
5. **Maturity build-out** — the other four maturity columns, non-technical/document
   evidence, full maturity scoring across all three baselines.
6. **Reporting** — auditor evidence packages, Type II period support, per-baseline views.
