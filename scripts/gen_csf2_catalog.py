#!/usr/bin/env python3
"""Generate data/frameworks/csf2.yaml from the NIST CSF 2.0 Reference Tool export.

Source: https://csrc.nist.gov/extensions/nudp/services/json/csf/download?olirids=all
        (vendored at data/vendor/csf/csf-2.0-reference-tool.xlsx)

NIST publications are US Government works and not subject to copyright, so
unlike the ISO and SOC 2 catalogs the subcategory text can be carried verbatim.

Two things this filters, both of which would otherwise put wrong requirements in
the product:

  * The export mixes CSF v1.1 categories in with 2.0 — ID.BE, ID.GV, PR.AC,
    PR.IP, DE.DP, RS.RP, RC.IM and friends are v1.1 and were restructured. Only
    the 22 CSF 2.0 Core categories are kept.

  * Withdrawn subcategories are retained by the reference tool for traceability
    and marked "[Withdrawn: ...]". They are not live requirements. Dropping them
    takes 132 rows down to the 106 of CSF 2.0 Core.
"""
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "vendor" / "csf" / "csf-2.0-reference-tool.xlsx"
OUT = ROOT / "data" / "frameworks" / "csf2.yaml"
XW_OUT = ROOT / "data" / "mappings" / "csf2-crosswalk.yaml"
CONTROLS = ROOT / "data" / "controls.yaml"

# CSF 2.0 Core: 6 functions, 22 categories.
CSF2 = {
    "GV": ["OC", "RM", "RR", "PO", "OV", "SC"],
    "ID": ["AM", "RA", "IM"],
    "PR": ["AA", "AT", "DS", "PS", "IR"],
    "DE": ["CM", "AE"],
    "RS": ["MA", "AN", "CO", "MI"],
    "RC": ["RP", "CO"],
}
KEEP = {f"{f}.{c}" for f, cs in CSF2.items() for c in cs}

FUNC_RE = re.compile(r"^([A-Z ]+)\s*\(([A-Z]{2})\)\s*:")
CAT_RE = re.compile(r"^(.+?)\s*\(([A-Z]{2}\.[A-Z]{2})\)\s*:")
SUB_RE = re.compile(r"^([A-Z]{2}\.[A-Z]{2}-\d{2})\s*:\s*(.*)$", re.S)


def col_index(ref: str) -> int:
    letters = re.match(r"([A-Z]+)", ref).group(1)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def read_rows(path: Path):
    z = zipfile.ZipFile(path)
    shared = [
        "".join(t.text or "" for t in si.iter(f"{NS}t"))
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(f"{NS}si")
    ]

    def value(c):
        v = c.find(f"{NS}v")
        if v is None:
            return ""
        return shared[int(v.text)] if c.get("t") == "s" else (v.text or "")

    rows = []
    # Empty cells are omitted from the XML, so honour each cell's column ref
    # rather than its position among siblings.
    for r in ET.fromstring(z.read("xl/worksheets/sheet2.xml")).iter(f"{NS}row"):
        cells = {}
        for c in r.findall(f"{NS}c"):
            ref = c.get("r")
            if ref:
                cells[col_index(ref)] = value(c)
        rows.append([cells.get(i, "") for i in range(6)])
    return rows


def main() -> int:
    if not SRC.exists():
        print(f"missing source: {SRC}", file=sys.stderr)
        return 1

    # Control codes that actually exist in our CCF, so a mapping cannot point at
    # a control this deployment does not have.
    known = set(re.findall(r'code:\s*"([^"]+)"', CONTROLS.read_text(encoding="utf8")))

    functions, categories, subcategories = {}, {}, []
    mappings, dropped_refs = [], 0
    withdrawn = 0
    for a, b, c, _ex, refs, *_ in read_rows(SRC):
        a, b, c = a.strip(), b.strip(), c.strip()
        if a and not b and not c:
            m = FUNC_RE.match(a)
            if m:
                functions[m.group(2)] = m.group(1).strip().title()
        if b and not c:
            m = CAT_RE.match(b)
            if m and m.group(2) in KEEP:
                categories[m.group(2)] = m.group(1).strip()
        if c:
            m = SUB_RE.match(c)
            if not m or m.group(1).rsplit("-", 1)[0] not in KEEP:
                continue
            title = " ".join(m.group(2).split())
            if title.startswith("[Withdrawn"):
                withdrawn += 1
                continue
            subcategories.append((m.group(1), title))

            # NIST publishes 800-53 controls as "informative references" for each
            # subcategory. They are explicitly NOT equivalence claims — they
            # illustrate ways to achieve an outcome — so they map as `related`
            # rather than `equivalent`, and carry their own source so a human
            # cannot be credited with having asserted them.
            seen = set()
            for ref in re.findall(r"SP 800-53 Rev [\d.]+:\s*([A-Za-z]{2}-\d+(?:\(\d+\))?)", refs or ""):
                fam, num = ref.split("-", 1)
                # The reference tool zero-pads (PM-09); our catalog does not (PM-9).
                enh = ""
                if "(" in num:
                    num, enh = num.split("(", 1)
                    # Enhancements are zero-padded too: CM-7(02) here is CM-7(2)
                    # in our catalog. Missing this silently dropped 16 valid
                    # mappings as "control not found".
                    enh = f"({int(enh.rstrip(')'))})"
                code = f"{fam}-{int(num)}{enh}"
                if code in seen:
                    continue
                seen.add(code)
                if code not in known:
                    dropped_refs += 1
                    continue
                mappings.append((code, m.group(1)))

    subcategories.sort()
    lines = [
        "# NIST Cybersecurity Framework (CSF) 2.0",
        "# ----------------------------------------------------------------------------",
        "# GENERATED by scripts/gen_csf2_catalog.py — do not edit by hand.",
        "#",
        "# Source: NIST CSF 2.0 Reference Tool export, vendored at",
        "#   data/vendor/csf/csf-2.0-reference-tool.xlsx",
        "#",
        "# NIST publications are US Government works and not subject to copyright, so",
        "# unlike iso27001-2022.yaml and soc2-tsc.yaml the text here is verbatim rather",
        "# than paraphrased.",
        "#",
        f"# {len(functions)} functions, {len(categories)} categories, {len(subcategories)} subcategories.",
        f"# {withdrawn} withdrawn subcategories were dropped — the reference tool keeps them",
        "# for traceability, but they are not live requirements.",
        "meta:",
        "  framework: NIST Cybersecurity Framework",
        '  version: "2.0"',
        "  # Off until an organisation adopts it; see frameworks.enabled.",
        "  enabled: false",
        "  licence: Public domain (US Government work, 17 USC 105)",
        "  source_url: https://www.nist.gov/cyberframework",
        "functions:",
    ]
    for fid, fname in functions.items():
        lines.append(f'  - {{ id: "{fid}", title: "{fname}" }}')
    lines.append("categories:")
    for cid, ctitle in sorted(categories.items()):
        lines.append(f'  - {{ code: "{cid}", function: "{cid.split(".")[0]}", title: "{esc(ctitle)}" }}')
    lines.append("subcategories:")
    for sid, stitle in subcategories:
        lines.append(f'  - {{ code: "{sid}", category: "{sid.rsplit("-", 1)[0]}", title: "{esc(stitle)}" }}')

    OUT.write_text("\n".join(lines) + "\n", encoding="utf8")

    xw = [
        "# NIST 800-53 Rev 5 -> CSF 2.0 crosswalk",
        "# ----------------------------------------------------------------------------",
        "# GENERATED by scripts/gen_csf2_catalog.py — do not edit by hand.",
        "#",
        "# Derived from the `Informative References` column of the CSF 2.0 Reference",
        "# Tool export. NIST describes these as illustrating ways to achieve an",
        "# outcome, NOT as equivalence, so every edge is `related` at medium",
        "# confidence. Overstating them as `equivalent` would inflate coverage for",
        "# exactly the reason the rest of this codebase now refuses to.",
        f"# {len(mappings)} edges; {dropped_refs} references dropped as controls absent from our CCF.",
        "csf2:",
    ]
    for code, sub in sorted(set(mappings)):
        xw.append(
            f'  - {{ control: "{code}", requirement: "{sub}", '
            f'relationship: "related", confidence: "medium", source: "csf-informative-ref" }}'
        )
    XW_OUT.write_text("\n".join(xw) + "\n", encoding="utf8")
    print(f"wrote {XW_OUT.relative_to(ROOT)}: {len(set(mappings))} edges "
          f"({dropped_refs} refs dropped — control not in our catalog)")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(functions)} functions, "
          f"{len(categories)} categories, {len(subcategories)} subcategories "
          f"({withdrawn} withdrawn dropped)")
    return 0


def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


if __name__ == "__main__":
    raise SystemExit(main())
