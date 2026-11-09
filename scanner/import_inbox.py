#!/usr/bin/env python3
"""Load scan results from inbox/ into Supabase, then export inbox/context.json.

The Claude scan (run from Claude, at no API cost) writes inbox/scan-YYYYMMDD-HHMM.json.
This script, run by GitHub Actions, adds those signals to the register as PROPOSED,
records the scan, writes the daily snapshot, and exports the context the next scan
needs (risks, recent signals, sources) to inbox/context.json.

Environment: SUPABASE_URL, SUPABASE_SERVICE_KEY. Standard library only.
"""
import datetime as dt
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from scan import AREAS, DB, ENUMS, DUBAI, MAX_SIGNALS, clean_signal, next_num, now_iso, today  # noqa: E402


def import_file(db, path, risks, signals, sources):
    with open(path, encoding="utf-8") as f:
        res = json.load(f)
    open_risks = {k: v for k, v in risks.items() if v.get("status") != "Closed"}
    known = {(v.get("url") or "").rstrip("/") for v in signals.values()}
    n = next_num(signals.keys(), "SQ-")
    added = []
    limit = MAX_SIGNALS if not res.get("migration") else 100
    for s in (res.get("signals") or [])[:limit]:
        c = clean_signal(s, open_risks)
        if not c or c["url"].rstrip("/") in known:
            continue
        known.add(c["url"].rstrip("/"))
        n += 1
        sid = "SQ-%04d" % n
        notes = c["notes"] if c["notes"].startswith("Proposed by the system") else "Proposed by the system, to confirm. " + c["notes"]
        captured = s.get("captured") if re.match(r"^\d{4}-\d{2}-\d{2}$", str(s.get("captured") or "")) else today()
        c.update({"captured": captured, "decided_by": "claude", "decided_on": captured, "proposed": True,
                  "by": "claude", "at": res.get("at") or now_iso(), "notes": notes})
        db.put("signals", sid, c)
        signals[sid] = c
        added.append(sid)

    names = {(v.get("name") or "").lower() for v in sources.values()}
    sn = next_num(sources.keys(), "s")
    new_src = []
    for s in res.get("new_sources") or []:
        name = str(s.get("name") or "").strip()
        if not name or name.lower() in names or not re.match(r"^https?://", str(s.get("url") or "")):
            continue
        names.add(name.lower())
        sn += 1
        doc = {"name": name, "url": s["url"], "grade": s.get("grade") if s.get("grade") in ("A", "B", "C") else "C", "terms": "Not yet", "owner": "",
               "level": s.get("level") if s.get("level") in ENUMS["level"] else "Global",
               "area": s.get("area") if s.get("area") in AREAS else "Strategy and projects", "freq": s.get("freq") or "As issued",
               "feed": s.get("feed") or "Web", "why": str(s.get("why") or "Added by the daily scan for review."),
               "added": today(), "by": "claude", "at": now_iso()}
        db.put("sources", "s%03d" % sn, doc)
        sources["s%03d" % sn] = doc
        new_src.append(name)
    return added, new_src, str(res.get("note") or "").strip()[:300], res.get("at") or now_iso()


def export_context(risks, signals, sources):
    cutoff = (dt.datetime.now(DUBAI) - dt.timedelta(days=60)).strftime("%Y-%m-%d")
    ctx = {
        "exported_at": now_iso(),
        "next_signal_id": "SQ-%04d" % (next_num(signals.keys(), "SQ-") + 1),
        "risks": [{"id": k, "title": v.get("title"), "area": v.get("area"), "status": v.get("status"),
                   "likelihood": v.get("likelihood"), "impact": v.get("impact")} for k, v in sorted(risks.items())],
        "recent_signals": [{"id": k, "captured": v.get("captured"), "url": v.get("url"), "decision": v.get("decision"),
                            "proposed": v.get("proposed"), "risk_id": v.get("risk_id"), "summary": (v.get("summary") or "")[:140]}
                           for k, v in sorted(signals.items()) if (v.get("captured") or "") >= cutoff],
        "sources": [{"name": v.get("name"), "grade": v.get("grade"), "level": v.get("level"), "area": v.get("area"), "url": v.get("url")}
                    for k, v in sorted(sources.items())],
    }
    with open(os.path.join(ROOT, "inbox", "context.json"), "w", encoding="utf-8") as f:
        json.dump(ctx, f, indent=1, ensure_ascii=False)


def main():
    db = DB()
    meta = db.collection("meta")
    done = set((meta.get("imports") or {}).get("files") or [])
    risks, signals, sources = db.collection("risks"), db.collection("signals"), db.collection("sources")
    files = sorted(p for p in glob.glob(os.path.join(ROOT, "inbox", "scan-*.json")) if os.path.basename(p) not in done)
    lines = []
    for p in files:
        name = os.path.basename(p)
        added, new_src, note, at = import_file(db, p, risks, signals, sources)
        done.add(name)
        db.put("meta", "imports", {"files": sorted(done), "at": now_iso()})
        if not name.startswith("scan-migration"):
            db.put("meta", "scan", {"at": at, "by": "claude", "count": len(added), "note": note})
        stamp = dt.datetime.now(DUBAI).strftime("%Y%m%d_%H%M%S")
        db.put("log", "import_" + stamp, {"at": now_iso(), "by": "claude", "ref": "",
                                          "text": "Imported %s: %d proposed signal%s%s." % (name, len(added), "" if len(added) == 1 else "s",
                                                                                           (" (" + ", ".join(added) + ")") if added else "")})
        lines.append("%s: added %s; new sources: %s" % (name, ", ".join(added) or "none", ", ".join(new_src) or "none"))
    if files:
        db.put("snapshots", today(), {"date": today(), "at": now_iso(), "by": "claude", "note": "Daily position snapshot.",
                                      "risks": {k: {"likelihood": v.get("likelihood"), "impact": v.get("impact"), "status": v.get("status"), "title": v.get("title")}
                                                for k, v in risks.items()}})
    export_context(risks, signals, sources)
    summary = "\n".join(lines) or "No new scan files to import. Context exported."
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(summary + "\n")


if __name__ == "__main__":
    main()
