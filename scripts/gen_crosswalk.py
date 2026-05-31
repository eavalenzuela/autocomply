#!/usr/bin/env python3
"""Generate the full CCF -> SOC 2 / ISO 27001 crosswalk.

ISO mappings are lineage-derived: each control's iso_2005 clause is run through
ISO_TRANSITION (ISO 27002:2005 -> 27001:2022 Annex A). Controls with no 2005
ancestor (cats 00/03/13) use ISO_SPECIAL. SOC 2 mappings (SOC2_MAP) are
hand-authored against published TSC criteria. Non-authoritative bootstrap;
overridden by MyCSF ingest. Re-run after editing the tables below.
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

def load_controls():
    out = []
    for l in open(ROOT / "data/controls.yaml"):
        if not re.search(r'-\s*\{\s*code:', l):
            continue
        code = re.search(r'code:\s*"([^"]+)"', l).group(1)
        iso = re.search(r'iso_2005:\s*"([^"]+)"', l)
        out.append((code, iso.group(1) if iso else None))
    return out

# --- ISO 27002:2005 clause -> 27001:2022 Annex A: (target, relationship, confidence)
ISO_TRANSITION = {
    "5.1.1": [("A.5.1", "equivalent", "high")],
    "5.1.2": [("A.5.1", "partial", "high")],
    "6.1.1": [("A.5.4", "partial", "medium")],
    "6.1.2": [("A.5.2", "partial", "medium")],
    "6.1.3": [("A.5.2", "equivalent", "high")],
    "6.1.4": [("A.5.8", "related", "low")],
    "6.1.5": [("A.6.6", "equivalent", "high")],
    "6.1.6": [("A.5.5", "equivalent", "high")],
    "6.1.7": [("A.5.6", "equivalent", "high")],
    "6.1.8": [("A.5.35", "equivalent", "high")],
    "6.2.1": [("A.5.19", "partial", "high")],
    "6.2.2": [("A.5.19", "partial", "medium"), ("A.5.20", "partial", "medium")],
    "6.2.3": [("A.5.20", "equivalent", "high")],
    "7.1.1": [("A.5.9", "equivalent", "high")],
    "7.1.2": [("A.5.9", "partial", "high")],
    "7.1.3": [("A.5.10", "equivalent", "high")],
    "7.2.1": [("A.5.12", "equivalent", "high")],
    "7.2.2": [("A.5.13", "equivalent", "high")],
    "8.1.1": [("A.5.2", "partial", "medium")],
    "8.1.2": [("A.6.1", "equivalent", "high")],
    "8.1.3": [("A.6.2", "equivalent", "high")],
    "8.2.1": [("A.5.4", "equivalent", "high")],
    "8.2.2": [("A.6.3", "equivalent", "high")],
    "8.2.3": [("A.6.4", "equivalent", "high")],
    "8.3.1": [("A.6.5", "equivalent", "high")],
    "8.3.2": [("A.5.11", "equivalent", "high")],
    "8.3.3": [("A.5.18", "partial", "high")],
    "9.1.1": [("A.7.1", "equivalent", "high")],
    "9.1.2": [("A.7.2", "equivalent", "high")],
    "9.1.3": [("A.7.3", "equivalent", "high")],
    "9.1.4": [("A.7.5", "equivalent", "high")],
    "9.1.5": [("A.7.6", "equivalent", "high")],
    "9.1.6": [("A.7.2", "partial", "medium")],
    "9.2.1": [("A.7.8", "equivalent", "high")],
    "9.2.2": [("A.7.11", "equivalent", "high")],
    "9.2.3": [("A.7.12", "equivalent", "high")],
    "9.2.4": [("A.7.13", "equivalent", "high")],
    "9.2.5": [("A.7.9", "equivalent", "high")],
    "9.2.6": [("A.7.14", "equivalent", "high")],
    "9.2.7": [("A.7.9", "partial", "medium")],
    "10.1.1": [("A.5.37", "equivalent", "high")],
    "10.1.2": [("A.8.32", "equivalent", "high")],
    "10.1.3": [("A.5.3", "equivalent", "high")],
    "10.1.4": [("A.8.31", "equivalent", "high")],
    "10.2.1": [("A.5.22", "partial", "medium")],
    "10.2.2": [("A.5.22", "equivalent", "high")],
    "10.2.3": [("A.5.22", "partial", "medium")],
    "10.3.1": [("A.8.6", "equivalent", "high")],
    "10.3.2": [("A.8.29", "partial", "medium")],
    "10.4.1": [("A.8.7", "equivalent", "high")],
    "10.4.2": [("A.8.7", "partial", "medium")],
    "10.5.1": [("A.8.13", "equivalent", "high")],
    "10.6.1": [("A.8.20", "equivalent", "high")],
    "10.6.2": [("A.8.21", "equivalent", "high")],
    "10.7.1": [("A.7.10", "equivalent", "high")],
    "10.7.2": [("A.7.10", "partial", "medium")],
    "10.7.3": [("A.5.10", "partial", "medium")],
    "10.7.4": [("A.5.37", "partial", "low")],
    "10.8.1": [("A.5.14", "equivalent", "high")],
    "10.8.2": [("A.5.14", "partial", "medium")],
    "10.8.3": [("A.5.14", "partial", "medium")],
    "10.8.4": [("A.5.14", "partial", "medium")],
    "10.8.5": [("A.8.22", "related", "low")],
    "10.9.1": [("A.8.26", "partial", "medium")],
    "10.9.2": [("A.8.26", "partial", "medium")],
    "10.9.3": [("A.5.14", "related", "low")],
    "10.10.1": [("A.8.15", "equivalent", "high")],
    "10.10.2": [("A.8.16", "partial", "medium")],   # A.8.16 new_2022
    "10.10.3": [("A.8.15", "partial", "medium")],
    "10.10.4": [("A.8.15", "partial", "medium")],
    "10.10.5": [("A.8.15", "partial", "low")],
    "10.10.6": [("A.8.17", "equivalent", "high")],
    "11.1.1": [("A.5.15", "equivalent", "high")],
    "11.2.1": [("A.5.16", "partial", "high"), ("A.5.18", "partial", "medium")],
    "11.2.2": [("A.8.2", "equivalent", "high")],
    "11.2.3": [("A.5.17", "equivalent", "high")],
    "11.2.4": [("A.5.18", "subset", "high")],
    "11.3.1": [("A.5.17", "partial", "medium")],
    "11.3.2": [("A.8.1", "partial", "low")],
    "11.3.3": [("A.7.7", "equivalent", "high")],
    "11.4.1": [("A.8.20", "partial", "medium")],
    "11.4.2": [("A.8.5", "partial", "medium")],
    "11.4.3": [("A.8.20", "partial", "low")],
    "11.4.4": [("A.8.20", "partial", "low")],
    "11.4.5": [("A.8.22", "equivalent", "high")],
    "11.4.6": [("A.8.20", "partial", "medium")],
    "11.4.7": [("A.8.22", "partial", "medium")],
    "11.5.1": [("A.8.5", "equivalent", "high")],
    "11.5.2": [("A.8.5", "equivalent", "high")],
    "11.5.3": [("A.8.5", "partial", "medium")],
    "11.5.4": [("A.8.18", "equivalent", "high")],
    "11.5.5": [("A.8.5", "partial", "medium")],
    "11.5.6": [("A.8.20", "related", "low")],
    "11.6.1": [("A.8.3", "equivalent", "high")],
    "11.6.2": [("A.8.22", "partial", "medium")],
    "11.7.1": [("A.8.1", "partial", "medium")],
    "11.7.2": [("A.6.7", "equivalent", "high")],
    "12.1.1": [("A.8.26", "equivalent", "high")],
    "12.2.1": [("A.8.26", "partial", "medium")],
    "12.2.2": [("A.8.26", "partial", "medium")],
    "12.2.3": [("A.8.24", "partial", "medium")],
    "12.2.4": [("A.8.26", "partial", "medium")],
    "12.3.1": [("A.8.24", "equivalent", "high")],
    "12.3.2": [("A.8.24", "partial", "high")],
    "12.4.1": [("A.8.19", "equivalent", "high")],
    "12.4.2": [("A.8.33", "equivalent", "high")],
    "12.4.3": [("A.8.4", "equivalent", "high")],
    "12.5.1": [("A.8.32", "equivalent", "high")],
    "12.5.2": [("A.8.32", "partial", "medium")],
    "12.5.3": [("A.8.32", "partial", "medium")],
    "12.5.4": [("A.8.12", "partial", "medium")],   # A.8.12 new_2022
    "12.5.5": [("A.8.30", "equivalent", "high")],
    "12.6.1": [("A.8.8", "equivalent", "high")],
    "13.1.1": [("A.6.8", "equivalent", "high")],
    "13.1.2": [("A.6.8", "partial", "medium")],
    "13.2.1": [("A.5.24", "equivalent", "high"), ("A.5.26", "partial", "medium")],
    "13.2.2": [("A.5.27", "equivalent", "high")],
    "13.2.3": [("A.5.28", "equivalent", "high")],
    "14.1.1": [("A.5.29", "equivalent", "high")],
    "14.1.2": [("A.5.29", "partial", "medium")],
    "14.1.3": [("A.5.29", "partial", "medium")],
    "14.1.4": [("A.5.29", "partial", "medium")],
    "14.1.5": [("A.5.30", "partial", "medium")],   # A.5.30 new_2022
    "15.1.1": [("A.5.31", "equivalent", "high")],
    "15.1.2": [("A.5.32", "equivalent", "high")],
    "15.1.3": [("A.5.33", "equivalent", "high")],
    "15.1.4": [("A.5.34", "equivalent", "high")],
    "15.1.5": [("A.5.10", "partial", "medium")],
    "15.1.6": [("A.8.24", "partial", "low")],
    "15.2.1": [("A.5.36", "equivalent", "high")],
    "15.2.2": [("A.5.36", "partial", "medium")],
    "15.3.1": [("A.8.34", "equivalent", "high")],
    "15.3.2": [("A.8.34", "partial", "medium")],
}

# ISO for HITRUST-specific controls (no 2005 ancestor). iso-clause targets allowed.
ISO_SPECIAL = {
    "0.a":  [("4.4", "partial", "medium"), ("5.2", "partial", "low")],
    "03.a": [("6.1.1", "partial", "high")],
    "03.b": [("6.1.2", "equivalent", "high"), ("8.2", "partial", "medium")],
    "03.c": [("6.1.3", "equivalent", "high"), ("8.3", "partial", "medium")],
    "03.d": [("6.1.2", "partial", "medium")],
    "13.a": [("A.5.34", "partial", "low")],
    "13.b": [("A.5.34", "related", "low")],
    "13.c": [("A.5.34", "related", "low")],
    "13.d": [("A.5.34", "related", "low")],
    "13.e": [("A.5.34", "related", "low")],
    "13.f": [("A.5.34", "related", "low")],
    "13.g": [("A.5.34", "related", "low")],
    "13.h": [("A.5.34", "related", "low")],
    "13.i": [("A.5.34", "related", "low")],
    "13.j": [("A.5.34", "related", "low")],
    "13.k": [("A.5.34", "related", "low")],
    "13.l": [("A.5.34", "related", "low")],
    "13.m": [("A.5.34", "related", "low")],
    "13.n": [("A.5.34", "related", "low")],
    "13.o": [("A.5.34", "related", "low")],
    "13.p": [("A.5.34", "related", "low")],
    "13.q": [("A.5.34", "related", "low")],
    "13.r": [("A.5.34", "related", "low")],
}

# SOC 2 TSC, hand-authored. Controls absent here have no defensible SOC 2 nexus
# (they surface in the gap report).
SOC2_MAP = {
    "0.a":  [("CC1.1", "partial", "medium"), ("CC2.1", "partial", "low")],
    "01.a": [("CC6.1", "partial", "medium"), ("CC6.3", "partial", "medium")],
    "01.b": [("CC6.2", "equivalent", "high")],
    "01.c": [("CC6.3", "partial", "high")],
    "01.d": [("CC6.1", "partial", "medium")],
    "01.e": [("CC6.2", "partial", "high"), ("CC6.3", "partial", "medium")],
    "01.f": [("CC6.1", "partial", "low")],
    "01.g": [("CC6.1", "partial", "low")],
    "01.h": [("CC6.1", "related", "low")],
    "01.i": [("CC6.6", "partial", "medium")],
    "01.j": [("CC6.1", "partial", "medium"), ("CC6.6", "partial", "medium")],
    "01.k": [("CC6.1", "related", "low")],
    "01.l": [("CC6.6", "partial", "medium")],
    "01.m": [("CC6.6", "partial", "medium")],
    "01.n": [("CC6.6", "partial", "medium")],
    "01.o": [("CC6.6", "related", "low")],
    "01.p": [("CC6.1", "partial", "high")],
    "01.q": [("CC6.1", "partial", "high")],
    "01.r": [("CC6.1", "partial", "medium")],
    "01.s": [("CC6.3", "partial", "medium")],
    "01.t": [("CC6.1", "partial", "medium")],
    "01.u": [("CC6.1", "related", "low")],
    "01.v": [("CC6.1", "partial", "medium"), ("CC6.3", "partial", "medium")],
    "01.w": [("CC6.1", "partial", "medium")],
    "01.x": [("CC6.7", "partial", "medium")],
    "01.y": [("CC6.7", "partial", "medium")],
    "02.a": [("CC1.3", "partial", "medium")],
    "02.b": [("CC1.4", "partial", "medium")],
    "02.c": [("CC1.4", "partial", "medium"), ("CC2.2", "partial", "low")],
    "02.d": [("CC1.5", "partial", "medium")],
    "02.e": [("CC1.4", "partial", "medium")],
    "02.f": [("CC1.5", "partial", "medium")],
    "02.g": [("CC6.2", "partial", "high")],
    "02.h": [("CC6.5", "partial", "medium")],
    "02.i": [("CC6.3", "partial", "high")],
    "03.a": [("CC3.1", "partial", "medium")],
    "03.b": [("CC3.2", "equivalent", "high")],
    "03.c": [("CC9.1", "partial", "medium"), ("CC3.2", "partial", "medium")],
    "03.d": [("CC3.2", "partial", "medium")],
    "04.a": [("CC5.3", "partial", "high")],
    "04.b": [("CC5.3", "partial", "medium")],
    "05.a": [("CC1.1", "partial", "medium")],
    "05.b": [("CC1.3", "partial", "medium")],
    "05.c": [("CC1.3", "equivalent", "high")],
    "05.d": [("CC6.2", "related", "low")],
    "05.e": [("CC1.4", "partial", "medium"), ("CC2.3", "partial", "low")],
    "05.f": [("CC2.3", "partial", "medium")],
    "05.g": [("CC2.3", "related", "low")],
    "05.h": [("CC4.1", "partial", "medium")],
    "05.i": [("CC9.2", "partial", "medium")],
    "05.j": [("CC9.2", "partial", "medium"), ("CC2.3", "partial", "low")],
    "05.k": [("CC9.2", "equivalent", "high")],
    "06.a": [("CC2.3", "related", "low")],
    "06.c": [("C1.1", "partial", "low")],
    "06.d": [("P1.1", "related", "low")],
    "06.e": [("CC6.1", "related", "low")],
    "06.g": [("CC5.3", "partial", "medium"), ("CC4.1", "partial", "medium")],
    "06.h": [("CC4.1", "partial", "medium"), ("CC7.1", "partial", "medium")],
    "06.i": [("CC4.1", "partial", "medium")],
    "06.j": [("CC4.1", "related", "low")],
    "07.a": [("CC6.1", "partial", "medium")],
    "07.b": [("CC6.1", "related", "low")],
    "07.c": [("CC6.1", "related", "low"), ("CC2.2", "related", "low")],
    "07.d": [("C1.1", "partial", "medium")],
    "07.e": [("C1.1", "partial", "medium")],
    "08.a": [("CC6.4", "equivalent", "high")],
    "08.b": [("CC6.4", "equivalent", "high")],
    "08.c": [("CC6.4", "partial", "high")],
    "08.d": [("A1.2", "partial", "medium")],
    "08.e": [("CC6.4", "partial", "medium")],
    "08.f": [("CC6.4", "partial", "medium")],
    "08.g": [("CC6.4", "partial", "medium")],
    "08.h": [("A1.2", "partial", "medium")],
    "08.i": [("CC6.4", "related", "low")],
    "08.j": [("A1.2", "related", "low")],
    "08.k": [("CC6.4", "partial", "medium"), ("CC6.7", "partial", "low")],
    "08.l": [("CC6.5", "equivalent", "high")],
    "08.m": [("CC6.4", "related", "low")],
    "09.a": [("CC2.2", "partial", "medium"), ("CC5.3", "partial", "low")],
    "09.b": [("CC8.1", "equivalent", "high")],
    "09.c": [("CC5.2", "partial", "medium"), ("CC3.3", "partial", "low")],
    "09.d": [("CC8.1", "partial", "medium")],
    "09.e": [("CC9.2", "partial", "medium")],
    "09.f": [("CC9.2", "partial", "medium")],
    "09.g": [("CC9.2", "partial", "medium"), ("CC8.1", "partial", "low")],
    "09.h": [("A1.1", "equivalent", "high")],
    "09.i": [("CC8.1", "partial", "medium")],
    "09.j": [("CC6.8", "equivalent", "high")],
    "09.k": [("CC6.8", "partial", "medium")],
    "09.l": [("A1.2", "partial", "high")],
    "09.m": [("CC6.6", "partial", "high")],
    "09.n": [("CC6.6", "partial", "medium")],
    "09.o": [("CC6.7", "partial", "medium")],
    "09.p": [("CC6.5", "partial", "medium")],
    "09.q": [("CC6.7", "partial", "medium"), ("C1.1", "partial", "low")],
    "09.r": [("CC6.1", "related", "low")],
    "09.s": [("CC6.7", "partial", "medium")],
    "09.t": [("CC6.7", "related", "low"), ("CC9.2", "related", "low")],
    "09.u": [("CC6.7", "partial", "medium")],
    "09.v": [("CC6.7", "partial", "medium")],
    "09.w": [("CC6.6", "related", "low")],
    "09.x": [("PI1.1", "related", "low")],
    "09.y": [("PI1.2", "partial", "medium")],
    "09.z": [("CC6.1", "related", "low")],
    "09.aa": [("CC7.2", "partial", "high")],
    "09.ab": [("CC7.2", "equivalent", "high")],
    "09.ac": [("CC7.2", "partial", "medium")],
    "09.ad": [("CC7.2", "partial", "medium")],
    "09.ae": [("CC7.2", "partial", "medium"), ("A1.1", "related", "low")],
    "09.af": [("CC7.2", "related", "low")],
    "10.a": [("CC8.1", "partial", "medium"), ("CC3.4", "partial", "low")],
    "10.b": [("PI1.2", "equivalent", "high")],
    "10.c": [("PI1.3", "equivalent", "high")],
    "10.d": [("PI1.3", "partial", "medium"), ("CC6.7", "partial", "low")],
    "10.e": [("PI1.4", "equivalent", "high")],
    "10.f": [("CC6.1", "partial", "medium"), ("CC6.7", "partial", "medium")],
    "10.g": [("CC6.1", "partial", "medium")],
    "10.h": [("CC8.1", "partial", "medium")],
    "10.i": [("CC8.1", "related", "low"), ("C1.1", "related", "low")],
    "10.j": [("CC6.1", "partial", "medium"), ("CC8.1", "partial", "low")],
    "10.k": [("CC8.1", "equivalent", "high")],
    "10.l": [("CC8.1", "partial", "medium")],
    "10.m": [("CC8.1", "partial", "medium")],
    "10.n": [("CC6.7", "partial", "medium")],
    "10.o": [("CC8.1", "partial", "medium"), ("CC9.2", "partial", "low")],
    "10.p": [("CC7.1", "equivalent", "high")],
    "11.a": [("CC7.3", "partial", "high")],
    "11.b": [("CC7.3", "partial", "medium")],
    "11.c": [("CC7.4", "equivalent", "high")],
    "11.d": [("CC7.5", "partial", "medium"), ("CC4.2", "partial", "low")],
    "11.e": [("CC7.3", "related", "low")],
    "12.a": [("CC9.1", "partial", "medium")],
    "12.b": [("CC9.1", "partial", "medium"), ("CC3.2", "partial", "low")],
    "12.c": [("A1.2", "partial", "medium"), ("CC9.1", "partial", "medium")],
    "12.d": [("CC9.1", "partial", "medium")],
    "12.e": [("A1.3", "equivalent", "high")],
    "13.a": [("P1.1", "equivalent", "high")],
    "13.b": [("P1.1", "partial", "medium")],
    "13.c": [("P8.1", "partial", "medium"), ("CC1.5", "partial", "low")],
    "13.d": [("P8.1", "partial", "medium"), ("CC3.2", "partial", "low")],
    "13.e": [("P2.1", "equivalent", "high")],
    "13.f": [("P3.1", "partial", "medium"), ("P4.1", "partial", "medium")],
    "13.g": [("P3.1", "equivalent", "high")],
    "13.h": [("P3.1", "partial", "medium")],
    "13.i": [("P6.1", "partial", "medium")],
    "13.j": [("P6.1", "equivalent", "high")],
    "13.k": [("P6.7", "equivalent", "high")],
    "13.l": [("P7.1", "equivalent", "high")],
    "13.m": [("P5.1", "equivalent", "high")],
    "13.n": [("P5.2", "equivalent", "high")],
    "13.o": [("P4.2", "equivalent", "high"), ("P4.3", "partial", "medium")],
    "13.p": [("P8.1", "equivalent", "high")],
    "13.q": [("P8.1", "partial", "medium")],
    "13.r": [("P4.1", "related", "low")],
}


def emit(rows, source):
    out = []
    for code, reqs in rows:
        for req, rel, conf in reqs:
            out.append(f'  - {{ control: "{code}", requirement: "{req}", '
                       f'relationship: {rel}, confidence: {conf}, source: {source} }}')
    return "\n".join(out)


def main():
    controls = load_controls()
    iso_rows, soc2_rows, no_iso, no_soc2 = [], [], [], []
    for code, iso2005 in controls:
        if iso2005:
            if iso2005 not in ISO_TRANSITION:
                sys.exit(f"ERROR: no ISO_TRANSITION entry for {iso2005} (control {code})")
            iso_rows.append((code, ISO_TRANSITION[iso2005]))
        elif code in ISO_SPECIAL:
            iso_rows.append((code, ISO_SPECIAL[code]))
        else:
            no_iso.append(code)
        if code in SOC2_MAP:
            soc2_rows.append((code, SOC2_MAP[code]))
        else:
            no_soc2.append(code)

    iso_links = sum(len(r[1]) for r in iso_rows)
    soc2_links = sum(len(r[1]) for r in soc2_rows)
    body = f"""# CCF -> SOC 2 / ISO 27001 crosswalk  (generated by scripts/gen_crosswalk.py)
# ----------------------------------------------------------------------------
# Non-authoritative bootstrap. ISO = lineage-derived (control -> 27002:2005 ->
# 27001:2022 Annex A via ISO_TRANSITION); SOC 2 = hand-authored vs published TSC.
# Overridden by MyCSF crosswalk ingest. Edit the tables in the script + re-run.
#
#   relationship = equivalent | superset | subset | partial | related
#   confidence   = high | medium | low
#   source       = lineage-derived | manual | mycsf-ingest
meta:
  status: bootstrap-complete
  controls_total: {len(controls)}
  iso_mapped: {len(iso_rows)}    # controls with >=1 ISO mapping
  soc2_mapped: {len(soc2_rows)}
  iso_links: {iso_links}
  soc2_links: {soc2_links}
  unmapped_iso: {no_iso}
  unmapped_soc2: {no_soc2}

soc2:
{emit(soc2_rows, "manual")}

iso27001:
{emit([(c, m) for c, m in iso_rows], "lineage-derived")}
"""
    (ROOT / "data/mappings/ccf-crosswalk.yaml").write_text(body)
    print(f"controls={len(controls)}  iso_mapped={len(iso_rows)} ({iso_links} links)  "
          f"soc2_mapped={len(soc2_rows)} ({soc2_links} links)")
    print(f"unmapped to ISO:  {no_iso or 'none'}")
    print(f"unmapped to SOC2: {no_soc2 or 'none'}")


if __name__ == "__main__":
    main()
