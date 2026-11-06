#!/usr/bin/env python3
"""Build app/index.html: the register page connected to Supabase.

  python3 -I tools/build_app.py --page REGISTER.html --out app/index.html

REGISTER.html is the register page (the claude.ai page as saved by the Artifact
read action, or a newer version of it). The page itself is not changed: three
scripts are added before its own script (supabase-js, config.js, adapter.js).
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile

MARKER = "<script>\n(function () {\n'use strict';"
# Latest 2.x: needed for the new sb_publishable_ keys.
SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--page", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    with open(a.page, encoding="utf-8") as f:
        page = f.read()
    if page.count(MARKER) != 1:
        print("Page layout changed: script start marker not found once. Nothing written.")
        return 2
    page = page.replace("<title>Emerging Risk Register</title>",
                        "<title>Emerging Risk Register</title>\n<link rel=\"manifest\" href=\"manifest.webmanifest\">\n<meta name=\"theme-color\" content=\"#1a5ccf\">", 1)
    head = ('<script src="%s"></script>\n<script src="config.js"></script>\n<script src="adapter.js"></script>\n' % SUPABASE_JS)
    out = page.replace(MARKER, head + MARKER)
    if shutil.which("node"):
        for i, js in enumerate(re.findall(r"<script>(.*?)</script>", out, re.S)):
            with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as t:
                t.write(js)
            r = subprocess.run(["node", "--check", t.name], capture_output=True, text=True)
            os.unlink(t.name)
            if r.returncode != 0:
                print("Script error in the built page (script %d); nothing written. %s" % (i, r.stderr.strip()[:300]))
                return 2
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(out)
    print("Built " + a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
