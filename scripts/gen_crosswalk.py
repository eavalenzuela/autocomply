#!/usr/bin/env python3
"""Generate the 800-53 control -> SOC 2 / ISO 27001:2022 crosswalk.

Keyed on NIST SP 800-53 Rev 5 *base* control codes (AC-1, AC-2, ...). Enhancements
inherit their base control's mappings implicitly (they roll up under it in the UI),
so only base controls are mapped here.

  - ISO 27001:2022 targets (Annex A + clauses) are derived from the published NIST
    OLIR 800-53r5 <-> ISO/IEC 27001:2022 informative reference. Codes only — ISO
    clause text is copyrighted and never stored.
  - SOC 2 / AICPA TSC targets are hand-authored against the published TSC criteria
    (codes are facts; TSC prose is AICPA-copyrighted and never stored).

Non-authoritative bootstrap — high-confidence correspondences only; unmapped base
controls land in the gap report (meta.unmapped_*). Edit the tables below + re-run.

  relationship = equivalent | superset | subset | partial | related
  confidence   = high | medium | low
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent


def load_base_controls():
    """Read base-control codes (the `objectives:` section of controls.yaml)."""
    out, section = [], None
    for line in open(ROOT / "data/controls.yaml"):
        s = line.strip()
        if s.endswith(":") and not s.startswith("-"):
            section = s[:-1]
            continue
        if section == "objectives" and s.startswith("- {"):
            code = s.split('code: "', 1)[1].split('"', 1)[0]
            out.append(code)
    return out


# --- 800-53 base control -> ISO/IEC 27001:2022 (Annex A code or clause), rel, conf
ISO = {
    # Policy controls (every family's -1) -> ISMS policy + topic-specific policies
    **{f"{fam}-1": [("A.5.1", "partial", "high"), ("A.5.37", "partial", "medium")]
       for fam in ["AC", "AT", "AU", "CA", "CM", "CP", "IA", "IR", "MA", "MP",
                   "PE", "PL", "PS", "PT", "RA", "SA", "SC", "SI", "SR"]},
    # Access Control
    "AC-2": [("A.5.16", "equivalent", "high"), ("A.5.18", "partial", "high")],
    "AC-3": [("A.5.15", "equivalent", "high"), ("A.8.3", "partial", "high")],
    "AC-4": [("A.8.22", "partial", "medium"), ("A.8.20", "partial", "medium")],
    "AC-5": [("A.5.3", "equivalent", "high")],
    "AC-6": [("A.8.2", "equivalent", "high")],
    "AC-7": [("A.8.5", "partial", "medium")],
    "AC-8": [("A.5.10", "related", "low")],
    "AC-11": [("A.7.7", "equivalent", "high")],
    "AC-12": [("A.8.5", "partial", "medium")],
    "AC-17": [("A.6.7", "equivalent", "high"), ("A.8.5", "partial", "medium")],
    "AC-18": [("A.8.20", "partial", "medium")],
    "AC-19": [("A.8.1", "equivalent", "high")],
    "AC-20": [("A.8.20", "partial", "low"), ("A.5.14", "partial", "low")],
    "AC-22": [("A.5.34", "related", "low")],
    # Awareness and Training
    "AT-2": [("A.6.3", "equivalent", "high")],
    "AT-3": [("A.6.3", "partial", "high")],
    "AT-4": [("A.6.3", "partial", "medium")],
    # Audit and Accountability
    "AU-2": [("A.8.15", "equivalent", "high")],
    "AU-3": [("A.8.15", "partial", "high")],
    "AU-5": [("A.8.15", "partial", "medium")],
    "AU-6": [("A.8.15", "partial", "high"), ("A.8.16", "partial", "high")],
    "AU-8": [("A.8.17", "equivalent", "high")],
    "AU-9": [("A.8.15", "partial", "medium")],
    "AU-11": [("A.5.33", "partial", "medium")],
    "AU-12": [("A.8.15", "partial", "high")],
    # Assessment, Authorization, and Monitoring
    "CA-2": [("9.2.1", "partial", "medium")],
    "CA-3": [("A.5.14", "partial", "medium")],
    "CA-5": [("10.2", "partial", "low")],
    "CA-6": [("9.3.1", "partial", "low")],
    "CA-7": [("A.8.16", "partial", "high"), ("9.1", "partial", "medium")],
    "CA-9": [("A.8.22", "partial", "medium")],
    # Configuration Management
    "CM-2": [("A.8.9", "equivalent", "high")],
    "CM-3": [("A.8.32", "equivalent", "high")],
    "CM-5": [("A.8.4", "partial", "medium"), ("A.8.2", "partial", "low")],
    "CM-6": [("A.8.9", "partial", "high")],
    "CM-7": [("A.8.19", "partial", "medium")],
    "CM-8": [("A.5.9", "equivalent", "high")],
    "CM-10": [("A.5.32", "partial", "medium"), ("A.8.19", "partial", "low")],
    "CM-11": [("A.8.19", "equivalent", "high")],
    "CM-12": [("A.5.12", "partial", "medium")],
    # Contingency Planning
    "CP-2": [("A.5.29", "equivalent", "high"), ("A.5.30", "partial", "high")],
    "CP-3": [("A.5.29", "partial", "medium")],
    "CP-4": [("A.5.29", "partial", "medium")],
    "CP-9": [("A.8.13", "equivalent", "high")],
    "CP-10": [("A.5.29", "partial", "high"), ("A.8.14", "partial", "medium")],
    # Identification and Authentication
    "IA-2": [("A.5.16", "equivalent", "high"), ("A.8.5", "partial", "high")],
    "IA-4": [("A.5.16", "partial", "high")],
    "IA-5": [("A.5.17", "equivalent", "high")],
    "IA-6": [("A.8.5", "partial", "medium")],
    "IA-8": [("A.5.16", "partial", "medium")],
    # Incident Response
    "IR-2": [("A.6.3", "related", "low")],
    "IR-4": [("A.5.24", "partial", "high"), ("A.5.26", "equivalent", "high")],
    "IR-5": [("A.5.25", "equivalent", "high")],
    "IR-6": [("A.6.8", "equivalent", "high")],
    "IR-7": [("A.5.24", "partial", "medium")],
    "IR-8": [("A.5.24", "equivalent", "high")],
    # Maintenance
    "MA-2": [("A.7.13", "partial", "medium")],
    "MA-3": [("A.7.13", "partial", "low")],
    "MA-4": [("A.6.7", "partial", "low"), ("A.8.5", "partial", "low")],
    "MA-5": [("A.7.13", "related", "low")],
    # Media Protection
    "MP-2": [("A.7.10", "partial", "high")],
    "MP-4": [("A.7.10", "partial", "high")],
    "MP-5": [("A.7.10", "partial", "high"), ("A.5.14", "partial", "medium")],
    "MP-6": [("A.7.14", "equivalent", "high"), ("A.8.10", "partial", "high")],
    "MP-7": [("A.7.10", "partial", "medium")],
    # Physical and Environmental Protection
    "PE-2": [("A.7.2", "partial", "high")],
    "PE-3": [("A.7.1", "equivalent", "high"), ("A.7.2", "partial", "high")],
    "PE-6": [("A.7.4", "equivalent", "high")],
    "PE-8": [("A.7.2", "partial", "medium")],
    "PE-12": [("A.7.11", "partial", "medium")],
    "PE-13": [("A.7.5", "partial", "high")],
    "PE-14": [("A.7.5", "partial", "medium")],
    "PE-15": [("A.7.5", "partial", "medium")],
    "PE-16": [("A.7.10", "partial", "low")],
    "PE-17": [("A.6.7", "equivalent", "high")],
    "PE-18": [("A.7.8", "equivalent", "high"), ("A.7.5", "partial", "medium")],
    # Planning
    "PL-2": [("A.5.1", "related", "low")],
    "PL-4": [("A.5.10", "partial", "high"), ("A.6.2", "partial", "medium")],
    "PL-8": [("A.8.27", "equivalent", "high")],
    # Program Management (mostly ISMS clauses)
    "PM-1": [("5.2", "partial", "high"), ("A.5.1", "partial", "high")],
    "PM-2": [("A.5.2", "equivalent", "high"), ("5.3", "partial", "high")],
    "PM-3": [("7.1", "partial", "medium")],
    "PM-5": [("A.5.9", "equivalent", "high")],
    "PM-6": [("9.1", "partial", "medium")],
    "PM-7": [("A.8.27", "partial", "medium")],
    "PM-9": [("6.1.1", "partial", "high"), ("6.1.2", "partial", "high")],
    "PM-10": [("9.3.1", "partial", "medium")],
    "PM-15": [("A.5.6", "equivalent", "high")],
    "PM-16": [("A.5.7", "equivalent", "high")],
    # Personnel Security
    "PS-3": [("A.6.1", "equivalent", "high")],
    "PS-4": [("A.6.5", "equivalent", "high")],
    "PS-5": [("A.6.5", "partial", "high")],
    "PS-6": [("A.6.2", "partial", "high"), ("A.6.6", "partial", "high")],
    "PS-7": [("A.6.1", "partial", "medium")],
    "PS-8": [("A.6.4", "equivalent", "high")],
    # PII Processing and Transparency
    "PT-2": [("A.5.34", "partial", "high")],
    "PT-3": [("A.5.34", "partial", "high")],
    "PT-4": [("A.5.34", "partial", "medium")],
    "PT-5": [("A.5.34", "partial", "medium")],
    # Risk Assessment
    "RA-2": [("A.5.12", "equivalent", "high")],
    "RA-3": [("6.1.2", "equivalent", "high"), ("8.2", "partial", "high")],
    "RA-5": [("A.8.8", "equivalent", "high")],
    "RA-7": [("6.1.3", "partial", "medium"), ("8.3", "partial", "medium")],
    # System and Services Acquisition
    "SA-3": [("A.8.25", "equivalent", "high")],
    "SA-4": [("A.5.20", "partial", "high")],
    "SA-8": [("A.8.27", "equivalent", "high")],
    "SA-9": [("A.5.21", "partial", "high"), ("A.5.22", "partial", "high")],
    "SA-10": [("A.8.31", "partial", "medium"), ("A.8.32", "partial", "medium")],
    "SA-11": [("A.8.29", "equivalent", "high")],
    "SA-15": [("A.8.25", "partial", "high")],
    "SA-22": [("A.8.8", "partial", "medium")],
    # System and Communications Protection
    "SC-5": [("A.8.6", "related", "low")],
    "SC-7": [("A.8.20", "equivalent", "high"), ("A.8.22", "partial", "high"), ("A.8.23", "partial", "medium")],
    "SC-8": [("A.8.24", "partial", "high"), ("A.5.14", "partial", "medium")],
    "SC-12": [("A.8.24", "partial", "high")],
    "SC-13": [("A.8.24", "equivalent", "high")],
    "SC-15": [("A.8.20", "related", "low")],
    "SC-20": [("A.8.20", "partial", "low")],
    "SC-21": [("A.8.20", "partial", "low")],
    "SC-28": [("A.8.24", "partial", "high")],
    # System and Information Integrity
    "SI-2": [("A.8.8", "equivalent", "high"), ("A.8.32", "partial", "medium")],
    "SI-3": [("A.8.7", "equivalent", "high")],
    "SI-4": [("A.8.16", "equivalent", "high")],
    "SI-5": [("A.5.6", "partial", "medium"), ("A.8.8", "partial", "medium")],
    "SI-7": [("A.8.8", "related", "low")],
    "SI-12": [("A.5.33", "partial", "medium")],
    # Supply Chain Risk Management
    "SR-2": [("A.5.19", "equivalent", "high")],
    "SR-3": [("A.5.20", "partial", "high"), ("A.5.21", "partial", "high")],
    "SR-5": [("A.5.21", "partial", "medium")],
    "SR-6": [("A.5.22", "equivalent", "high")],
    "SR-8": [("A.5.20", "partial", "medium")],
    "SR-11": [("A.5.21", "partial", "medium")],
}

# --- 800-53 base control -> SOC 2 / AICPA TSC criterion, rel, conf (hand-authored)
SOC2 = {
    "AC-1": [("CC6.1", "partial", "medium")],
    "AC-2": [("CC6.1", "partial", "high"), ("CC6.2", "partial", "high"), ("CC6.3", "partial", "high")],
    "AC-3": [("CC6.1", "partial", "high"), ("CC6.3", "partial", "medium")],
    "AC-4": [("CC6.6", "partial", "medium")],
    "AC-5": [("CC6.3", "partial", "high")],
    "AC-6": [("CC6.1", "partial", "high"), ("CC6.3", "partial", "high")],
    "AC-7": [("CC6.1", "related", "low")],
    "AC-8": [("CC6.1", "related", "low")],
    "AC-11": [("CC6.1", "related", "low")],
    "AC-12": [("CC6.1", "related", "low")],
    "AC-17": [("CC6.6", "partial", "high"), ("CC6.7", "partial", "medium")],
    "AC-18": [("CC6.6", "partial", "medium")],
    "AC-19": [("CC6.7", "partial", "medium")],
    "AC-20": [("CC6.1", "related", "low")],
    "AC-22": [("CC6.1", "related", "low")],
    "AT-2": [("CC1.4", "partial", "medium"), ("CC2.2", "partial", "medium")],
    "AT-3": [("CC1.4", "partial", "medium")],
    "AU-2": [("CC7.2", "partial", "high")],
    "AU-3": [("CC7.2", "partial", "medium")],
    "AU-6": [("CC7.2", "partial", "high"), ("CC7.3", "partial", "medium")],
    "AU-9": [("CC7.2", "partial", "medium")],
    "AU-11": [("CC7.2", "related", "low")],
    "AU-12": [("CC7.2", "partial", "medium")],
    "CA-2": [("CC4.1", "partial", "high")],
    "CA-3": [("CC6.1", "related", "low")],
    "CA-5": [("CC4.2", "partial", "medium")],
    "CA-6": [("CC4.1", "related", "low")],
    "CA-7": [("CC4.1", "partial", "high"), ("CC7.2", "partial", "medium")],
    "CM-2": [("CC8.1", "partial", "high")],
    "CM-3": [("CC8.1", "equivalent", "high")],
    "CM-6": [("CC8.1", "partial", "high")],
    "CM-7": [("CC8.1", "partial", "medium")],
    "CM-8": [("CC6.1", "partial", "medium")],
    "CP-2": [("A1.2", "partial", "high"), ("CC9.1", "partial", "medium")],
    "CP-3": [("A1.2", "related", "low")],
    "CP-9": [("A1.2", "equivalent", "high")],
    "CP-10": [("A1.3", "equivalent", "high")],
    "IA-2": [("CC6.1", "partial", "high")],
    "IA-4": [("CC6.2", "partial", "high")],
    "IA-5": [("CC6.1", "partial", "high")],
    "IA-8": [("CC6.1", "partial", "medium")],
    "IR-4": [("CC7.3", "partial", "high"), ("CC7.4", "partial", "high")],
    "IR-5": [("CC7.3", "partial", "medium")],
    "IR-6": [("CC7.3", "partial", "medium")],
    "IR-8": [("CC7.4", "partial", "high"), ("CC7.5", "partial", "medium")],
    "MP-2": [("CC6.4", "partial", "medium"), ("CC6.5", "partial", "medium")],
    "MP-4": [("CC6.4", "partial", "medium")],
    "MP-6": [("CC6.5", "equivalent", "high")],
    "PE-2": [("CC6.4", "partial", "high")],
    "PE-3": [("CC6.4", "equivalent", "high")],
    "PE-6": [("CC6.4", "partial", "medium")],
    "PL-2": [("CC2.2", "partial", "low")],
    "PL-4": [("CC1.1", "partial", "low")],
    "PS-2": [("CC1.4", "partial", "medium")],
    "PS-3": [("CC1.4", "partial", "high")],
    "PS-4": [("CC6.5", "partial", "medium"), ("CC1.4", "partial", "low")],
    "PS-6": [("CC6.2", "partial", "medium")],
    "PS-7": [("CC9.2", "partial", "medium")],
    "PS-8": [("CC1.5", "partial", "medium")],
    "RA-3": [("CC3.1", "partial", "high"), ("CC3.2", "partial", "high")],
    "RA-5": [("CC7.1", "partial", "high")],
    "SA-4": [("CC9.2", "partial", "medium")],
    "SA-9": [("CC9.2", "partial", "high")],
    "SA-22": [("CC7.1", "partial", "medium")],
    "SC-5": [("A1.1", "partial", "medium")],
    "SC-7": [("CC6.6", "partial", "high")],
    "SC-8": [("CC6.7", "partial", "high")],
    "SC-12": [("CC6.1", "partial", "medium")],
    "SC-13": [("CC6.1", "partial", "medium")],
    "SC-28": [("CC6.1", "partial", "high"), ("C1.1", "partial", "medium")],
    "SI-2": [("CC7.1", "partial", "high")],
    "SI-3": [("CC6.8", "equivalent", "high")],
    "SI-4": [("CC7.2", "equivalent", "high")],
    "SI-5": [("CC7.1", "partial", "medium")],
    "SI-7": [("CC6.8", "partial", "medium")],
    "SR-2": [("CC9.2", "partial", "high")],
    "SR-3": [("CC9.2", "partial", "high")],
    "SR-6": [("CC9.2", "partial", "medium")],
    "PT-2": [("P3.1", "partial", "high")],
    "PT-3": [("P3.1", "partial", "high"), ("P3.2", "partial", "medium")],
    "PT-4": [("P5.1", "partial", "medium")],
    "PT-5": [("P1.1", "partial", "high")],
}


def emit(rows, source):
    out = []
    for code in sorted(rows):
        for req, rel, conf in rows[code]:
            out.append(f'  - {{ control: "{code}", requirement: "{req}", '
                       f'relationship: {rel}, confidence: {conf}, source: {source} }}')
    return "\n".join(out)


def main():
    controls = load_base_controls()
    present = set(controls)
    # sanity: every mapping key must be a real base control
    for table, name in [(ISO, "ISO"), (SOC2, "SOC2")]:
        for code in table:
            if code not in present:
                raise SystemExit(f"ERROR: {name} maps unknown base control {code}")

    iso_rows = {c: ISO[c] for c in controls if c in ISO}
    soc2_rows = {c: SOC2[c] for c in controls if c in SOC2}
    no_iso = [c for c in controls if c not in ISO]
    no_soc2 = [c for c in controls if c not in SOC2]
    iso_links = sum(len(v) for v in iso_rows.values())
    soc2_links = sum(len(v) for v in soc2_rows.values())

    body = f"""# 800-53 control -> SOC 2 / ISO 27001:2022 crosswalk  (generated by scripts/gen_crosswalk.py)
# ----------------------------------------------------------------------------
# Keyed on NIST SP 800-53 Rev 5 base control codes; enhancements inherit their
# base control's mappings. ISO = OLIR-derived (NIST 800-53r5 <-> ISO/IEC
# 27001:2022 informative reference, codes only). SOC 2 = hand-authored vs
# published AICPA TSC. Non-authoritative bootstrap. Edit the tables in the
# script + re-run.
#
#   relationship = equivalent | superset | subset | partial | related
#   confidence   = high | medium | low
#   source       = olir-derived | manual
meta:
  status: bootstrap
  base_controls_total: {len(controls)}
  iso_mapped: {len(iso_rows)}    # base controls with >=1 ISO mapping
  soc2_mapped: {len(soc2_rows)}
  iso_links: {iso_links}
  soc2_links: {soc2_links}
  unmapped_iso_count: {len(no_iso)}
  unmapped_soc2_count: {len(no_soc2)}

soc2:
{emit(soc2_rows, "manual")}

iso27001:
{emit(iso_rows, "olir-derived")}
"""
    (ROOT / "data/mappings/ccf-crosswalk.yaml").write_text(body)
    print(f"base_controls={len(controls)}  "
          f"iso_mapped={len(iso_rows)} ({iso_links} links)  "
          f"soc2_mapped={len(soc2_rows)} ({soc2_links} links)")
    print(f"unmapped to ISO:  {len(no_iso)} base controls")
    print(f"unmapped to SOC2: {len(no_soc2)} base controls")


if __name__ == "__main__":
    main()
