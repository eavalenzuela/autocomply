# Catalog export contract: autocomply → GRCen

This document is the **contract** for the controls-catalog export that autocomply
produces and the sibling GRC tool **GRCen** (`../GRCen`) consumes.

## Why this exists

In our three-tool stack, **autocomply is the system-of-record for control and
requirement definitions and the crosswalk between them** (the CCF + framework
requirements + mappings). GRCen is a *consumer*: it ingests a projection of the
catalog and adds the org-graph layer (owners, the systems a control protects,
audits, vendors). uvt is a second consumer, later.

So autocomply needs to emit the catalog in the shape below. GRCen already has the
importer that reads it (`grcen.services.catalog_sync` + `grcen sync-catalog`); it
is idempotent and keyed on the stable `ref` values you put here, so re-exporting
and re-syncing updates in place rather than duplicating.

**The job on the autocomply side — built.** The export serializes the CCF
controls, the loaded framework requirements, and the crosswalk mappings into a
single JSON document matching `contracts/grcen_catalog_export.schema.json`. The
producer lives in `server/src/catalog.ts` (`buildCatalog()`), exposed two ways:

- **`GET /api/catalog`** — read-only endpoint (in `server/src/app.ts`), the live projection.
- **CLI dump** — `npm --prefix server run catalog:dump --silent > catalog.json`
  (`server/src/catalog-dump.ts`); pass `--silent` so npm's banner stays out of stdout.

See "Producing it from autocomply's schema" below for the table mapping.

## The shape

```jsonc
{
  "catalog_version": "1",          // contract version; bump only on breaking change
  "source": "autocomply",          // informational provenance label
  "generated_at": "2026-05-31T00:00:00Z",  // optional, informational

  "frameworks": [
    {
      "ref": "soc2",               // STABLE id, unique among frameworks
      "name": "SOC 2",             // display name (GRCen asset name)
      "description": "Trust Services Criteria",
      "metadata": {                // optional; stored verbatim on the framework asset
        "version": "2017 (rev. 2022)",
        "governing_body": "AICPA"
      },
      "requirements": [
        {
          "ref": "soc2:CC6.1",     // STABLE id, unique across ALL requirements in the file
          "name": "CC6.1 — Logical access controls",
          "reference_id": "CC6.1", // optional → requirement.metadata.reference_id
          "category": "Common Criteria",  // optional → requirement.metadata.category
          "description": "..."     // optional
        }
      ]
    }
  ],

  "controls": [
    {
      "ref": "01.a",              // STABLE id, unique among controls (use the CCF code)
      "name": "Access Control Policy",
      "description": "...",        // optional
      "metadata": {                // optional; stored verbatim on the control asset
        "control_type": "preventive"
      },
      "satisfies": ["soc2:CC6.1"]  // requirement refs this control satisfies; each
                                   // MUST match a requirement.ref above
    }
  ]
}
```

## How GRCen maps it (so you know what each field drives)

| Catalog object | GRCen asset / edge | Notes |
|---|---|---|
| `framework` | `asset(type=framework)` | `metadata` stored verbatim |
| `requirement` | `asset(type=requirement)` | `metadata.framework` is auto-set to the parent framework's name; `reference_id`/`category` folded into metadata |
| `framework → requirement` | `parent_of` edge | how the dashboard discovers a framework's requirements |
| `control` | `asset(type=control)` | `metadata` stored verbatim |
| `control.satisfies[]` | `satisfies` edge (control → requirement) | marks the requirement **covered** on the `/frameworks` coverage/gap dashboard |

Those two edge types (`parent_of`, `satisfies`) are exactly what GRCen's framework
dashboard keys off, so a synced catalog lights up coverage automatically. A
requirement with no satisfying control shows as a **gap** — which is the correct
state for a freshly-loaded catalog before controls are mapped.

## Rules that matter

1. **`ref` values are stable identifiers, not display text.** GRCen upserts on
   `(source, ref)`. Use autocomply's own internal ids: the framework slug
   (`soc2`, `iso27001`), the CCF control code (`01.a`), and a namespaced
   requirement id. **Never recycle or renumber a `ref`** — changing it orphans the
   old GRCen asset and creates a new one (the old one then shows up as "stale" on
   sync and is removed only with `--prune`).

2. **Requirement `ref`s must be globally unique within the file.** Prefix them
   with the framework ref (`soc2:CC6.1`, `iso27001:A.8.1`) so two frameworks that
   both have a "6.1" don't collide.

3. **`satisfies` may only reference requirement `ref`s present in the same
   document.** GRCen rejects the whole catalog if a control points at an unknown
   requirement (fail-closed; nothing is written). Export controls and the
   requirements they map to together.

4. **Names can change freely; refs cannot.** Renaming a framework/requirement/
   control (changing `name`) updates the existing GRCen asset in place because the
   `ref` is unchanged. That's the intended way to push edits.

5. **Removing an item** from the export prunes its mapping edges on the next sync;
   the orphaned framework/requirement/control asset is reported as stale and is
   only deleted when GRCen is run with `--prune` (because deleting a control in
   GRCen cascades to any org-graph edges a human attached to it).

## Producing it from autocomply's schema

The export is a join over autocomply's existing tables (`server/src/db/schema.ts`):

- `frameworks` → catalog `frameworks[]` (`ref` = framework slug, `name` = title)
- `requirements` → nested `requirements[]` under their framework
  (`ref` = `<framework-slug>:<requirement-code>`, `reference_id` = the bare code)
- `controls` → catalog `controls[]` (`ref` = CCF control code, e.g. `01.a`)
- `mappings` (control ↔ requirement crosswalk) → each control's `satisfies[]`,
  emitting the requirement `ref` for every mapped requirement

The crosswalk's relationship-type/confidence fields don't have a home in GRCen's
binary covered/gap model yet, so the producer stashes them in each control's
`metadata.crosswalk` (`{ "<req-ref>": { relationship, confidence } }`) — they
survive the trip verbatim while `satisfies[]` stays the flat ref list GRCen keys
off. Keep the export **read-only**: it's a projection of autocomply state, never
an inbound mutation.

### Ways to produce it
- **`GET /api/catalog`** — live pull (GRCen syncs against it). Each call is
  audit-logged (`catalog-export`, `mode=api`).
- **CLI dump** — `npm --prefix server run catalog:dump --silent > catalog.json`.
- **Scheduled file export** — set `CATALOG_EXPORT_PATH` (and optionally
  `CATALOG_EXPORT_INTERVAL_MS`, default 6h) on the API process; it writes the
  catalog to that path on boot and on the interval, for an external syncer to
  pick up. The Integrations page shows export status (counts + last export).

## Validating before you ship it

Validate your output against `contracts/grcen_catalog_export.schema.json` (JSON
Schema draft 2020-12). `contracts/grcen_catalog_export.example.json` is a minimal
valid document you can diff against. On the GRCen side, a dry run checks the same
contract without writing:

```bash
grcen sync-catalog catalog.json --dry-run        # validate + report counts, roll back
grcen sync-catalog catalog.json --org acme        # apply to a specific org (default org if omitted)
grcen sync-catalog catalog.json --prune           # also delete assets dropped upstream
```
