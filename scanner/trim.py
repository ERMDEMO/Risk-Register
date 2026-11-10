#!/usr/bin/env python3
"""One-off: trim the register to an example set, after saving a full backup.

Reads inbox/trim-*.json: {"keep_risks": [...], "keep_signals": [...], "note": "..."}.
Writes backup/register-backup.json (uploaded as a private workflow artifact by trim.yml),
deletes every other risk and signal, trims snapshots to the kept risks, replaces the
activity log with one entry, and exports a fresh inbox/context.json.
"""
import glob
import json
import os
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from scan import DB, now_iso  # noqa: E402
from import_inbox import export_context  # noqa: E402


def delete_except(db, col, keep):
    q = "%s?collection=eq.%s" % (db.url, col)
    if keep:
        q += "&id=not.in.(%s)" % ",".join(urllib.parse.quote(k) for k in keep)
    db._req("DELETE", q, extra={"Prefer": "return=minimal"})


def main():
    files = sorted(glob.glob(os.path.join(ROOT, "inbox", "trim-*.json")))
    if not files:
        print("No trim file.")
        return 0
    spec = json.load(open(files[-1], encoding="utf-8"))
    keep_r, keep_s = spec["keep_risks"], spec["keep_signals"]
    db = DB()
    meta = db.collection("meta")
    if files[-1] and os.path.basename(files[-1]) in ((meta.get("trims") or {}).get("files") or []):
        print("Already applied.")
        return 0
    backup = {c: db.collection(c) for c in ("risks", "signals", "sources", "log", "snapshots", "meta")}
    os.makedirs(os.path.join(ROOT, "backup"), exist_ok=True)
    with open(os.path.join(ROOT, "backup", "register-backup.json"), "w", encoding="utf-8") as f:
        json.dump(backup, f, ensure_ascii=False, indent=1)
    missing = [k for k in keep_r if k not in backup["risks"]] + [k for k in keep_s if k not in backup["signals"]]
    if missing:
        print("Stopped: these ids are not in the register: " + ", ".join(missing))
        return 1

    delete_except(db, "risks", keep_r)
    delete_except(db, "signals", keep_s)
    for sid in keep_s:  # unlink signals from risks that no longer exist
        s = backup["signals"][sid]
        if s.get("risk_id") and s["risk_id"] not in keep_r:
            db.put("signals", sid, dict(s, risk_id="", decision="Watch" if s.get("decision") in ("Add to existing risk", "New risk") else s.get("decision")))
    for day, snap in backup["snapshots"].items():
        snap = dict(snap, risks={k: v for k, v in (snap.get("risks") or {}).items() if k in keep_r})
        db.put("snapshots", day, snap)
    delete_except(db, "log", [])
    db.put("log", "trim_" + now_iso()[:10].replace("-", ""), {"at": now_iso(), "by": "claude", "ref": "",
                                                              "text": spec.get("note") or "Register trimmed to an example set."})
    db.put("meta", "trims", {"files": [os.path.basename(files[-1])], "at": now_iso()})

    risks, signals, sources = db.collection("risks"), db.collection("signals"), db.collection("sources")
    export_context(risks, signals, sources)
    print("Kept %d risks (%s) and %d signals (%s). Backup saved as a workflow artifact." % (
        len(risks), ", ".join(sorted(risks)), len(signals), ", ".join(sorted(signals))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
