# Setting up the browser app

The app lives at **https://ermdemo.github.io/Risk-Register/app/**. It stores the register in Supabase, signs people in, lets the team move signals into the register, and has a **Run scan now** button. Scans run on GitHub Actions using the Anthropic API.

Do the steps in order. Steps 1 to 4 take about 15 minutes.

## 1. Create the database (Supabase → SQL Editor)

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Open `supabase/schema.sql` in this repository, copy all of it, paste it, click **Run**. You should see "Success. No rows returned".
3. New query again: copy all of `supabase/seed.sql`, paste, **Run**. This loads the current risks, signals, sources and history.

## 2. Set up the team code

Everyone uses one shared team account. People open the link, type the **team code** once, and enter their own name, which is shown on their decisions. Nobody needs their own account.

1. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up", then **Save**.
2. **Authentication → Users → Add user → Create new user**:
   - Email: `team@risk-register.app` (exactly this; it is set in `app/config.js`)
   - Password: choose the **team code**, at least 10 characters, for example three random words. This is what people type.
   - Tick **Auto Confirm User**, then **Create user**.
3. **SQL Editor → New query**: paste all of `supabase/team_access.sql`, **Run**. This puts the team account on the team list, keeps a history of every change, and limits **Run scan now** to 6 times a day.

Share the link and the team code with your team, separately if you can (for example the link by email and the code by phone).

To change the team code: **Authentication → Users** → the team account → **⋯ → Send password recovery** is not needed; instead delete the user and create it again with the same email and a new password. Everyone then enters the new code.

## 3. Add the secrets the scanner needs (GitHub)

In this repository: **Settings → Secrets and variables → Actions → New repository secret**. Add three secrets:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | `https://axxqqoqlwremtxlehgvt.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase → **Project Settings → API Keys** → the **secret** key (`sb_secret_…`), or the legacy **service_role** key |
| `ANTHROPIC_API_KEY` | Your key from console.anthropic.com |

Never put the secret key or the Anthropic key in the app files or in an issue.

Optional: **Variables** tab → `SCAN_MODEL` to choose the model (default `claude-sonnet-5-5`; `claude-opus-5-5` is more thorough and costs more).

## 4. Test

1. Open **https://ermdemo.github.io/Risk-Register/app/**, enter the team code and your name.
2. Check the Radar, Signals and Register look like the main register.
3. Click **Run scan now**. Within about 10 to 20 minutes the status next to the button changes to "Scanning…" and then "Last scan … N new signals". You can also start a scan at once: **Actions → Emerging risk scan → Run workflow**.
4. If a scan fails, open **Actions**, click the failed run, and read the last lines of "Run the scanner".

## How it runs

- **Daily scan** at 08:35 Abu Dhabi time.
- **Run scan now**: the button records a request; GitHub checks for requests every 10 minutes (GitHub sometimes runs this later than scheduled).
- Each scan adds up to 8 **proposed** signals, adds new outlets as grade C sources for review, records the daily position snapshot (Movement tab) and updates the scan strip.
- GitHub pauses scheduled workflows in a repository with no activity for 60 days. If scans stop, open **Actions** and click **Enable workflow**.

## Files

| File | What it is |
| --- | --- |
| `app/index.html` | The app (the register page plus three scripts) |
| `app/adapter.js` | Connects the page to Supabase: sign-in, live updates, Run scan now |
| `app/config.js` | Supabase address and publishable key (public by design) |
| `supabase/schema.sql`, `supabase/seed.sql` | Database tables, security rules and starting data |
| `scanner/scan.py`, `scanner/prompt.md` | The scanner and its instructions |
| `.github/workflows/scan.yml` | When scans run |
| `tools/build_app.py` | Rebuilds `app/index.html` when the page design changes |
