# Running the scan from Claude (free route)

Claude runs the research; GitHub loads the result into the register. Steps:

1. Get the repository: `git clone --depth 1 https://github.com/ERMDEMO/risk-register /home/claude/risk-register`, or `git -C /home/claude/risk-register pull --ff-only origin main` if it exists.
2. Read `inbox/context.json`: open risks, signals from the last 60 days (with URLs and summaries), and approved sources with grades. It is refreshed after every import and at 08:00 Abu Dhabi time.
3. Research the themes listed in `scanner/prompt.md`, searching grade A sources first, then B; grade C is a lead only. Follow the "Verify before you propose" rules in that file: open every page, write only what it says, report claims as claims, merge duplicates, skip anything already in context.json (same URL or same event), skip items older than 14 days unless important and missing, at most 8 signals, and zero is fine on a quiet day. Never write the organisation's name; write "the organisation".
4. Write `inbox/scan-YYYYMMDD-HHMM.json` (Abu Dhabi time):
   `{"at": ISO time, "by": "claude", "note": one line, "signals": [...], "new_sources": [...]}`
   Each signal has the fields in the Output section of `scanner/prompt.md`, plus `"captured": "YYYY-MM-DD"`. Do not add ids: the import assigns them.
5. Commit only that file and push to main. The "Import scan results" workflow loads it within about a minute; its run summary lists the new SQ ids.
6. Report: signals added (ids from the import), the top items, and anything that failed.
