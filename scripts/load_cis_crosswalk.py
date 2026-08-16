#!/usr/bin/env python3
"""Load the authored CIS crosswalk through the product's own API.

Deliberately not through the seed loader. These correspondences are editorial
judgement rather than published data, so they go in the way a person would enter
them: POST /api/mappings, which records them source="manual" and writes an audit
entry naming who asserted them. The trail should not imply CIS published these.

  ADMIN_EMAIL=... ADMIN_PASSWORD=... BASE_URL=http://localhost:8082 \
    python3 scripts/load_cis_crosswalk.py [--dry-run]
"""
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
XW = ROOT / "data" / "mappings" / "cis-v8-crosswalk-authored.yaml"
BASE = os.environ.get("BASE_URL", "http://localhost:8082")
EMAIL = os.environ.get("ADMIN_EMAIL", "admin@localhost")
PASSWORD = os.environ.get("ADMIN_PASSWORD")
DRY = "--dry-run" in sys.argv


class Client:
    def __init__(self):
        self.cookie = None

    def call(self, method, path, body=None):
        req = urllib.request.Request(
            BASE + path,
            method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"content-type": "application/json", **({"cookie": self.cookie} if self.cookie else {})},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                set_cookie = r.headers.get("set-cookie")
                if set_cookie:
                    self.cookie = set_cookie.split(";")[0]
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")


def main() -> int:
    if not PASSWORD and not DRY:
        print("set ADMIN_PASSWORD", file=sys.stderr)
        return 1

    data = yaml.safe_load(XW.read_text(encoding="utf8"))
    planned = []
    for strength, rel, conf in (("direct", "partial", "high"), ("support", "related", "medium")):
        for sg, controls in (data.get(strength) or {}).items():
            for ctrl in controls:
                planned.append((str(sg), ctrl, rel, conf))
    print(f"  {len(planned)} edges planned from {XW.name}")
    if DRY:
        for sg, ctrl, rel, conf in planned[:5]:
            print(f"    {ctrl:12s} -> cis-v8:{sg:6s} {rel}/{conf}")
        return 0

    c = Client()
    status, _ = c.call("POST", "/api/login", {"email": EMAIL, "password": PASSWORD})
    if status != 200:
        print(f"login failed: {status}", file=sys.stderr)
        return 1
    # Mapping writes are not step-up gated, but minting nothing else here either.
    status, reqs = c.call("GET", "/api/requirements?framework=cis-v8")
    if status != 200:
        print(f"cannot read cis-v8 requirements ({status}) — is the framework enabled?", file=sys.stderr)
        return 1
    req_id = {r["code"]: r["requirementId"] for r in reqs["requirements"]}

    created = skipped = failed = 0
    for sg, ctrl, rel, conf in planned:
        rid = req_id.get(sg)
        if rid is None:
            print(f"    no such requirement: {sg}", file=sys.stderr)
            failed += 1
            continue
        status, body = c.call(
            "POST",
            "/api/mappings",
            {"control": ctrl, "requirementId": rid, "relationship": rel, "confidence": conf,
             "note": "authored for this project; not CIS's published mapping"},
        )
        if status == 201:
            created += 1
        elif status == 409:
            skipped += 1  # already mapped
        else:
            failed += 1
            print(f"    {ctrl} -> {sg}: {status} {body.get('error','')}", file=sys.stderr)
    print(f"  created={created} already-present={skipped} failed={failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
