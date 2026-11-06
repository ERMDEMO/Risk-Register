#!/usr/bin/env python3
"""Emerging-risk scanner: searches the web with Claude and writes PROPOSED signals to Supabase.

Run by GitHub Actions (.github/workflows/scan.yml). Standard library only.

Environment
  SUPABASE_URL          https://xxxx.supabase.co
  SUPABASE_SERVICE_KEY  service_role key (GitHub secret; never in the page)
  ANTHROPIC_API_KEY     Anthropic API key (GitHub secret)
  MODEL                 optional, default claude-sonnet-5-5
  MODE                  daily | poll   (poll = run only if someone pressed "Run scan now")
"""
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DUBAI = dt.timezone(dt.timedelta(hours=4))
AREAS = ["Supply chain", "Operations", "Finance", "Cyber", "HSE", "Legal and regulatory", "Workforce", "Reputation", "Strategy and projects"]
FUNCS = ["Network operations and control", "Asset management and maintenance", "Network planning and engineering", "Projects and construction",
         "Metering and customer services", "Procurement and supply chain", "Finance and treasury", "HSE", "IT and OT security",
         "Legal, regulatory and compliance", "HR and workforce", "Communications and strategy"]
ENUMS = {"level": ["Local", "Regional", "Global"], "area": AREAS, "func": FUNCS, "horizon": ["Short", "Medium", "Long"],
         "touches": ["Yes", "Unsure", "No"], "conf": ["High", "Medium", "Low"], "checked": ["Yes", "Unsure"],
         "decision": ["Add to existing risk", "New risk", "Watch"]}
MAX_SIGNALS = 8


def now_iso():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def today():
    return dt.datetime.now(DUBAI).strftime("%Y-%m-%d")


# ---------------- Supabase REST ----------------
class DB:
    def __init__(self):
        self.url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/docs"
        key = os.environ["SUPABASE_SERVICE_KEY"]
        self.h = {"apikey": key, "Content-Type": "application/json"}
        if not key.startswith("sb_"):  # older JWT-style keys also go in the Authorization header
            self.h["Authorization"] = "Bearer " + key

    def _req(self, method, url, body=None, extra=None):
        h = dict(self.h, **(extra or {}))
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(url, data=data, method=method, headers=h)
        with urllib.request.urlopen(r, timeout=60) as resp:
            t = resp.read().decode()
            return json.loads(t) if t.strip() else None

    def collection(self, col):
        out, start, size = {}, 0, 1000
        while True:
            q = "%s?collection=eq.%s&select=id,data" % (self.url, urllib.parse.quote(col))
            rows = self._req("GET", q, extra={"Range-Unit": "items", "Range": "%d-%d" % (start, start + size - 1)})
            for r in rows:
                out[r["id"]] = r["data"]
            if len(rows) < size:
                return out
            start += size

    def put(self, col, doc_id, data):
        self._req("POST", self.url + "?on_conflict=collection,id", [{"collection": col, "id": doc_id, "data": data}],
                  extra={"Prefer": "resolution=merge-duplicates,return=minimal"})


# ---------------- Claude ----------------
TOOLS_NEW = [{"type": "web_search_20260209", "name": "web_search", "max_uses": 20},
             {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 25}]
TOOLS_OLD = [{"type": "web_search_20250305", "name": "web_search", "max_uses": 20},
             {"type": "web_fetch_20250910", "name": "web_fetch", "max_uses": 25}]


def claude(prompt):
    key = os.environ["ANTHROPIC_API_KEY"]
    model = os.environ.get("MODEL") or "claude-sonnet-5-5"
    variants = [(TOOLS_NEW, {}), (TOOLS_OLD, {"anthropic-beta": "web-fetch-2025-09-10"})]
    last_err = None
    for tools, extra in variants:
        messages = [{"role": "user", "content": prompt}]
        usage = {"input": 0, "output": 0, "searches": 0}
        try:
            for _ in range(8):  # follow pause_turn continuations
                body = {"model": model, "max_tokens": 16000, "tools": tools, "messages": messages}
                h = {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
                h.update(extra)
                r = urllib.request.Request((os.environ.get("ANTHROPIC_BASE_URL") or "https://api.anthropic.com").rstrip("/") + "/v1/messages", data=json.dumps(body).encode(), headers=h, method="POST")
                with urllib.request.urlopen(r, timeout=600) as resp:
                    res = json.loads(resp.read().decode())
                u = res.get("usage") or {}
                usage["input"] += u.get("input_tokens", 0)
                usage["output"] += u.get("output_tokens", 0)
                usage["searches"] += (u.get("server_tool_use") or {}).get("web_search_requests", 0)
                if res.get("stop_reason") == "pause_turn":
                    # Send the paused turn back so the model continues it.
                    if messages[-1]["role"] == "assistant":
                        messages[-1]["content"] = messages[-1]["content"] + res["content"]
                    else:
                        messages.append({"role": "assistant", "content": res["content"]})
                    continue
                text = "".join(b.get("text", "") for b in res.get("content", []) if b.get("type") == "text")
                return text, usage
            raise RuntimeError("the model did not finish after several continuations")
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:500]
            last_err = "Anthropic API %s: %s" % (e.code, msg)
            if e.code == 400 and ("tool" in msg.lower() or "type" in msg.lower()):
                continue  # try the older tool versions
            raise RuntimeError(last_err)
    raise RuntimeError(last_err or "Anthropic API call failed")


# ---------------- scan ----------------
def parse_result(text):
    m = re.search(r"<result>\s*(\{.*\})\s*</result>", text, re.S)
    raw = m.group(1) if m else text[text.find("{"): text.rfind("}") + 1]
    return json.loads(raw)


def clean_signal(s, risks_open):
    out = {}
    for k in ("published", "source", "url", "summary", "check", "notes", "risk_id"):
        out[k] = str(s.get(k) or "").strip()
    for k, allowed in ENUMS.items():
        v = str(s.get(k) or "").strip()
        out[k] = v if v in allowed else {"checked": "Unsure", "decision": "Watch", "touches": "Unsure", "conf": "Low"}.get(k, allowed[0])
    if not re.match(r"^https?://", out["url"]) or not out["summary"]:
        return None
    out["summary"] = out["summary"][:450]
    if out["decision"] == "Add to existing risk" and (out["checked"] != "Yes" or out["risk_id"] not in risks_open):
        out["decision"], out["risk_id"] = "Watch", ""
    if out["decision"] != "Add to existing risk":
        out["risk_id"] = ""
    return out


def next_num(ids, prefix):
    n = 0
    for i in ids:
        m = re.match(r"^%s(\d+)$" % prefix, i)
        if m:
            n = max(n, int(m.group(1)))
    return n


def run_scan(db, window):
    risks = db.collection("risks")
    signals = db.collection("signals")
    sources = db.collection("sources")
    open_risks = {k: v for k, v in risks.items() if v.get("status") != "Closed"}
    cutoff = (dt.datetime.now(DUBAI) - dt.timedelta(days=60)).strftime("%Y-%m-%d")
    recent = sorted(((k, v) for k, v in signals.items() if (v.get("captured") or "") >= cutoff), key=lambda kv: kv[0])
    day = dt.datetime.now(DUBAI).toordinal()
    prompt = open(os.path.join(HERE, "prompt.md"), encoding="utf-8").read().format(
        today=today(), window=window, focus=AREAS[day % len(AREAS)],
        risks="\n".join("- %s: %s (%s; likelihood %s, impact %s)" % (k, v.get("title", ""), v.get("area", ""), v.get("likelihood"), v.get("impact")) for k, v in sorted(open_risks.items())) or "- none",
        signals="\n".join("- %s %s | %s" % (k, v.get("url", ""), (v.get("summary") or "")[:110]) for k, v in recent) or "- none",
        sources="\n".join("- [%s, %s] %s: %s" % (v.get("grade", ""), v.get("level", ""), v.get("name", ""), v.get("url", "")) for k, v in sorted(sources.items())),
    )
    text, usage = claude(prompt)
    result = parse_result(text)

    known_urls = {(v.get("url") or "").rstrip("/") for v in signals.values()}
    n = next_num(signals.keys(), "SQ-")
    added = []
    for s in (result.get("signals") or [])[:MAX_SIGNALS]:
        c = clean_signal(s, open_risks)
        if not c or c["url"].rstrip("/") in known_urls:
            continue
        known_urls.add(c["url"].rstrip("/"))
        n += 1
        sid = "SQ-%04d" % n
        c.update({"captured": today(), "decided_by": "claude", "decided_on": today(), "proposed": True, "by": "claude", "at": now_iso(),
                  "notes": "Proposed by the system, to confirm. " + c["notes"]})
        db.put("signals", sid, c)
        added.append(sid)

    names = {(v.get("name") or "").lower() for v in sources.values()}
    sn = next_num(sources.keys(), "s")
    new_src = []
    for s in result.get("new_sources") or []:
        name = str(s.get("name") or "").strip()
        if not name or name.lower() in names or not re.match(r"^https?://", str(s.get("url") or "")):
            continue
        names.add(name.lower())
        sn += 1
        doc = {"name": name, "url": s["url"], "grade": "C", "terms": "Not yet", "owner": "", "level": s.get("level") if s.get("level") in ENUMS["level"] else "Global",
               "area": s.get("area") if s.get("area") in AREAS else "Strategy and projects", "freq": "As issued", "feed": "Web",
               "why": "Added by the daily scan for review: " + str(s.get("why") or ""), "added": today(), "by": "claude", "at": now_iso()}
        db.put("sources", "s%03d" % sn, doc)
        new_src.append(name)

    note = str(result.get("note") or "").strip()[:300]
    db.put("meta", "scan", {"at": now_iso(), "by": "claude", "count": len(added), "note": note})
    stamp = dt.datetime.now(DUBAI).strftime("%Y%m%d_%H%M")
    db.put("log", "scan_" + stamp, {"at": now_iso(), "by": "claude", "ref": "",
                                    "text": "Scan %s: added %d proposed signal%s%s." % (today(), len(added), "" if len(added) == 1 else "s",
                                                                                       (" (" + ", ".join(added) + ")") if added else "")})
    db.put("snapshots", today(), {"date": today(), "at": now_iso(), "by": "claude", "note": "Daily position snapshot.",
                                  "risks": {k: {"likelihood": v.get("likelihood"), "impact": v.get("impact"), "status": v.get("status"), "title": v.get("title")}
                                            for k, v in risks.items()}})
    return {"added": added, "new_sources": new_src, "note": note, "usage": usage}


def main():
    mode = os.environ.get("MODE", "daily")
    db = DB()
    req_id = None
    if mode == "poll":
        reqs = db.collection("scan_requests")
        pending = sorted((k for k, v in reqs.items() if v.get("status") == "requested"), key=lambda k: reqs[k].get("at", ""))
        if not pending:
            print("No scan requested.")
            return 0
        req_id = pending[-1]
        for k in pending[:-1]:
            db.put("scan_requests", k, dict(reqs[k], status="done", count=0, finished_at=now_iso(), note="Merged into a later request."))
        db.put("scan_requests", req_id, dict(reqs[req_id], status="running", started_at=now_iso()))
        window = "24 hours, plus anything since the last scan"
    else:
        window = "24 hours"
    try:
        out = run_scan(db, window)
    except Exception as e:  # report the failure on the page, then fail the job
        if req_id:
            reqs = db.collection("scan_requests")
            db.put("scan_requests", req_id, dict(reqs.get(req_id, {}), status="failed", finished_at=now_iso(), error=str(e)[:200]))
        raise
    if req_id:
        reqs = db.collection("scan_requests")
        db.put("scan_requests", req_id, dict(reqs.get(req_id, {}), status="done", finished_at=now_iso(), count=len(out["added"])))
    summary = "Added %d signal(s): %s. New sources for review: %s. Web searches: %d. Tokens in/out: %d/%d. %s" % (
        len(out["added"]), ", ".join(out["added"]) or "none", ", ".join(out["new_sources"]) or "none",
        out["usage"]["searches"], out["usage"]["input"], out["usage"]["output"], out["note"])
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(summary + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
