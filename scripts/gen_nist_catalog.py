#!/usr/bin/env python3
"""Generate data/controls.yaml from the vendored NIST SP 800-53 Rev 5 OSCAL catalog.

Source: usnistgov/oscal-content (CC0 / US-government public domain). The catalog
and the Low/Moderate/High baseline profiles are vendored under data/vendor/oscal/
so this build is offline and deterministic.

Mapping onto autocomply's 3-level taxonomy:
    category  = control family       (AC, AU, ...)            20
    objective = base control         (AC-1, AC-2, ...)       ~324
    control   = base + enhancement   (AC-2, AC-2(1), ...)   ~1196

Baseline membership (low/moderate/high) is read from the three profile JSONs and
tagged per control to drive the Low/Moderate/High tier feature. Re-run after
bumping the vendored OSCAL content.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OSCAL = ROOT / "data/vendor/oscal"
CATALOG = OSCAL / "NIST_SP-800-53_rev5_catalog.json"
PROFILES = {
    "low": OSCAL / "NIST_SP-800-53_rev5_LOW-baseline_profile.json",
    "moderate": OSCAL / "NIST_SP-800-53_rev5_MODERATE-baseline_profile.json",
    "high": OSCAL / "NIST_SP-800-53_rev5_HIGH-baseline_profile.json",
}


def clean_code(oscal_id: str) -> str:
    """ac-2.1 -> AC-2(1);  ac-1 -> AC-1.  Deterministic from the OSCAL id."""
    base, _, enh = oscal_id.partition(".")
    fam, _, num = base.partition("-")
    code = f"{fam.upper()}-{num}"
    return f"{code}({enh})" if enh else code


def base_of(oscal_id: str) -> str:
    """Objective (base control) code for any control id. ac-2.1 -> AC-2."""
    return clean_code(oscal_id.split(".")[0])


def load_baselines() -> dict:
    """control code -> sorted list of baselines it belongs to (cumulative)."""
    membership: dict[str, list[str]] = {}
    for name, path in PROFILES.items():
        prof = json.loads(path.read_text())["profile"]
        for imp in prof["imports"]:
            for inc in imp.get("include-controls", []):
                for oid in inc.get("with-ids", []):
                    membership.setdefault(clean_code(oid), []).append(name)
    order = {"low": 0, "moderate": 1, "high": 2}
    return {c: sorted(bs, key=order.__getitem__) for c, bs in membership.items()}


def walk(node, family, out_controls):
    """Emit a control row for every control (base + enhancement), depth-first."""
    for ctl in node.get("controls", []):
        code = clean_code(ctl["id"])
        out_controls.append(
            {
                "code": code,
                "category": family,
                "objective": base_of(ctl["id"]),
                "title": ctl["title"],
            }
        )
        walk(ctl, family, out_controls)


def yaml_list_inline(items, key_order):
    lines = []
    for it in items:
        parts = []
        for k in key_order:
            if k not in it:
                continue
            v = it[k]
            if isinstance(v, list):
                parts.append(f"{k}: [{', '.join(v)}]")
            else:
                parts.append(f'{k}: "{v}"' if k in ("title",) else f'{k}: "{v}"')
        lines.append("  - { " + ", ".join(parts) + " }")
    return "\n".join(lines)


def main():
    catalog = json.loads(CATALOG.read_text())["catalog"]
    baselines = load_baselines()

    categories, objectives, controls = [], [], []
    for group in catalog["groups"]:
        family = group["id"].upper()
        categories.append({"id": family, "title": group["title"]})
        for base in group.get("controls", []):
            objectives.append(
                {"code": clean_code(base["id"]), "category": family, "title": base["title"]}
            )
        walk(group, family, controls)

    # tag baseline membership (controls not in any baseline get an empty list)
    for c in controls:
        c["baselines"] = baselines.get(c["code"], [])

    in_any = sum(1 for c in controls if c["baselines"])
    header = (
        "# autocomply — control catalog\n"
        "# ----------------------------------------------------------------------------\n"
        "# Generated from the NIST SP 800-53 Rev 5 OSCAL catalog by\n"
        "# scripts/gen_nist_catalog.py. Source: usnistgov/oscal-content, which is a\n"
        "# work of the U.S. government — CC0 / public domain, freely redistributable\n"
        "# (titles and statement text alike). Edit the vendored OSCAL under\n"
        "# data/vendor/oscal/ and re-run the generator; do not hand-edit this file.\n"
        "#\n"
        "#   category  = 800-53 family       (AC, AU, ...)\n"
        "#   objective = base control        (AC-1, AC-2, ...)\n"
        "#   control   = base + enhancement  (AC-2, AC-2(1), ...)\n"
        "#   baselines = Low/Moderate/High membership (cumulative), drives the tier feature\n"
        "meta:\n"
        "  source: NIST SP 800-53 Rev 5 (OSCAL, public domain)\n"
        f"  counts: {{ families: {len(categories)}, base_controls: {len(objectives)}, "
        f"controls: {len(controls)}, in_baseline: {in_any} }}\n"
    )

    body = (
        header
        + "\ncategories:\n"
        + yaml_list_inline(categories, ["id", "title"])
        + "\n\nobjectives:\n"
        + yaml_list_inline(objectives, ["code", "category", "title"])
        + "\n\ncontrols:\n"
        + yaml_list_inline(controls, ["code", "category", "objective", "title", "baselines"])
        + "\n"
    )
    (ROOT / "data/controls.yaml").write_text(body)
    print(
        f"wrote data/controls.yaml: {len(categories)} families, "
        f"{len(objectives)} base controls, {len(controls)} controls "
        f"({in_any} in a baseline)"
    )


if __name__ == "__main__":
    main()
