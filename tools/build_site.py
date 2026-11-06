#!/usr/bin/env python3
"""Build index.html for GitHub Pages from the live Emerging Risk Register.

Inputs
  --page  the register page HTML, as saved by the Artifact read action
  --data  a folder holding the collections saved by ArtifactData (out_dir),
          one sub-folder per collection: risks, signals, sources, log,
          snapshots, meta (with meta/scan.json)
Output
  --out   index.html: the same page with the data built in and a local data
          adapter (tools/shim.js), shown read-only

Exit codes: 0 built, 2 the page layout changed (nothing written), 3 data missing.
"""
import argparse
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MARKER = "<script>\n(function () {\n'use strict';"
COLLECTIONS = ("risks", "signals", "sources", "log", "snapshots")


def unwrap(path):
    with open(path, encoding="utf-8") as f:
        x = json.load(f)
    if isinstance(x, dict) and isinstance(x.get("data"), dict):
        x = x["data"]
    return x


def clean(doc):
    # Opaque user ids are replaced so no account identifiers are published.
    for k in ("by", "decided_by"):
        v = doc.get(k)
        if isinstance(v, str) and v.startswith("u_"):
            doc[k] = "analyst"
    return doc


def load(folder):
    out = {}
    for p in sorted(glob.glob(os.path.join(folder, "*.json"))):
        doc_id = os.path.splitext(os.path.basename(p))[0]
        doc = clean(unwrap(p))
        doc["id"] = doc_id
        out[doc_id] = doc
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--page", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    with open(a.page, encoding="utf-8") as f:
        page = f.read()
    if page.count(MARKER) != 1:
        print("Page layout changed: script start marker not found once. Nothing written.")
        return 2

    seed = {c: load(os.path.join(a.data, c)) for c in COLLECTIONS}
    scan_path = os.path.join(a.data, "meta", "scan.json")
    if not seed["risks"] or not seed["signals"] or not os.path.exists(scan_path):
        print("Data missing: risks, signals or meta/scan not found. Nothing written.")
        return 3
    scan = clean(unwrap(scan_path))
    scan.pop("id", None)
    seed["meta"] = {"scan": scan}

    with open(os.path.join(HERE, "shim.js"), encoding="utf-8") as f:
        shim = f.read()
    version = str(scan.get("at", "v1")).replace(":", "").replace(".", "")
    payload = json.dumps(seed, ensure_ascii=False).replace("</", "<\\/")
    head = (
        "<script>window.__SEED__ = " + payload + ";\n"
        "window.__SEED_VERSION__ = " + json.dumps(version) + ";\n"
        "window.__READ_ONLY__ = true;</script>\n"
        "<script>\n" + shim + "</script>\n"
    )
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(page.replace(MARKER, head + MARKER))
    print("Built %s: %s" % (a.out, {k: len(v) for k, v in seed.items()}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
