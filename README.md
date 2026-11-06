# Emerging Risk Register

Horizon scanning for power and water networks in Abu Dhabi.

- **Website (read-only):** https://ermdemo.github.io/Risk-Register/ — rebuilt every morning after the daily scan.
- **Reviewing signals:** in the Issues tab, as described below.

## How the team reviews signals

Every morning (08:35 Abu Dhabi time) the scan opens one issue per new signal, labelled `signal`. Each issue has the summary, the source link, the suggested risk and what to check.

1. Open the issue and the source link. Check that the source says what the summary says.
2. Add **one** decision label:

   | Label | Meaning |
   | --- | --- |
   | `add-to-risk` | Evidence for the suggested risk. To link a different risk, add a comment with its id, for example `Risk: ER-05`. |
   | `new-risk` | Needs a new risk. The register owner creates it. |
   | `watch` | Keep watching; no register entry. |
   | `reject` | Not relevant or not reliable. |

3. Add a comment if you want to explain the decision. The comment goes into the register notes.

The next morning's scan copies each decision into the register, adds the `recorded` label and closes the issue. Only labels count: the scan does not act on anything written in comments except a `Risk: ER-xx` line.

## Asking for a change to a risk

Use **New issue → Risk change request** to ask for a new score, owner, action or status. The register owner reviews the request and makes the change.

## Important

This repository is public. Issues and comments can be read by anyone. Do not include confidential details, contract values or personal data.

## Files

- `index.html` — the published page (do not edit by hand; it is rebuilt daily)
- `tools/build_site.py`, `tools/shim.js` — build the page from the register data
