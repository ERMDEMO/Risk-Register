#!/usr/bin/env python3
"""Write supabase/seed.sql from the register collections saved by ArtifactData.

  python3 -I tools/make_seed.py --data DIR --out supabase/seed.sql

DIR holds one folder per collection (risks, signals, sources, log, snapshots)
and meta/scan.json. Existing rows with the same id are replaced.
"""
import argparse
import glob
import json
import os

COLLECTIONS = ("risks", "signals", "sources", "log", "snapshots")


def unwrap(path):
    with open(path, encoding="utf-8") as f:
        x = json.load(f)
    if isinstance(x, dict) and isinstance(x.get("data"), dict):
        x = x["data"]
    for k in ("by", "decided_by"):
        v = x.get(k)
        if isinstance(v, str) and v.startswith("u_"):
            x[k] = "analyst"
    return x


def lit(s):
    return "'" + s.replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    rows = []
    for c in COLLECTIONS:
        for p in sorted(glob.glob(os.path.join(a.data, c, "*.json"))):
            doc_id = os.path.splitext(os.path.basename(p))[0]
            d = unwrap(p)
            d.pop("id", None)
            rows.append((c, doc_id, d))
    scan = os.path.join(a.data, "meta", "scan.json")
    if os.path.exists(scan):
        d = unwrap(scan)
        d.pop("id", None)
        rows.append(("meta", "scan", d))
    with open(a.out, "w", encoding="utf-8") as f:
        f.write("-- Current register, loaded once after schema.sql. Safe to run again: rows are replaced.\n")
        f.write("insert into public.docs (collection, id, data) values\n")
        f.write(",\n".join("(%s, %s, %s::jsonb)" % (lit(c), lit(i), lit(json.dumps(d, ensure_ascii=False))) for c, i, d in rows))
        f.write("\non conflict (collection, id) do update set data = excluded.data;\n")
    counts = {}
    for c, _, _ in rows:
        counts[c] = counts.get(c, 0) + 1
    print("Wrote %s: %s" % (a.out, counts))


if __name__ == "__main__":
    main()
