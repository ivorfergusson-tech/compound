# One-off setup

Everything here is free. You do the clicks; the code is already written.

Secrets go in `.env` in this folder (gitignored). The site itself only ever holds the **publishable / anon** key, in `js/config.js`. Never put the **secret / service_role** key in the site or in git.

## 1. Supabase project (done 27 Oct 2026)
- supabase.com → sign in with GitHub → organisation (Personal, Free) → **New project** `compound`, region West EU (London).
- Database password → `.env` as `SUPABASE_DB_PASSWORD`.
- Project Settings → **API Keys**: publishable key → `.env` as `SUPABASE_ANON_KEY` (and into `js/config.js`). Project Settings → **Data API**: URL → `SUPABASE_URL`.

## 2. Create the tables (run the SQL)
1. Left sidebar → **SQL Editor** → **+ New query**.
2. Paste all of `supabase/schema.sql` → **Run** (bottom right).
3. You should see "Success. No rows returned". It's safe to run again after any change to the file.

What it makes: 7 tables (profiles, module_reads, attempts, srs, notes, guesses, active_days), Row Level Security on all of them (each person sees only their own rows), the nickname filter, the XP and level functions, the public `leaderboard` view (nickname, level, XP only) and `delete_my_account()`.

## 3. Sign-in links point at the right site
Left sidebar → **Authentication** → **URL Configuration**:
- **Site URL:** `https://ivorfergusson-tech.github.io/compound/` (once GitHub Pages is on; until then `http://127.0.0.1:8765/`).
- **Redirect URLs** → **Add URL**, one at a time:
  - `http://127.0.0.1:8765/**`
  - `http://localhost:8765/**`
  - `https://ivorfergusson-tech.github.io/compound/**`
- **Save**.

## 4. Email sign-in (magic link)
On by default. Supabase's built-in email only sends a few emails an hour, which is fine for testing. Before sharing widely, send them through Brevo (free, 300 a day):
- Brevo → **SMTP & API** → **SMTP** tab → note the server, port, login and generate an SMTP key.
- Supabase → **Authentication** → **Emails** → **SMTP Settings** → turn on **Enable custom SMTP**: host `smtp-relay.brevo.com`, port `587`, your Brevo login and SMTP key, sender name `Compound`, sender email one you've verified in Brevo → **Save**.

## 5. Google sign-in
**In Google Cloud** (console.cloud.google.com, signed in with your Google account):
1. Top bar project picker → **New project** → name `Compound` → **Create**, then select it.
2. Search bar → **Google Auth Platform** (or **APIs & Services → OAuth consent screen**) → **Get started**:
   App name `Compound`, support email yours → **Next** → Audience **External** → **Next** → contact email yours → **Next** → agree → **Create**.
3. **Branding**: add the authorised domain `supabase.co` (and later `github.io`) → **Save**.
4. **Clients** → **+ Create client** → type **Web application**, name `Compound web`.
   - **Authorised redirect URIs** → **+ Add URI** → `https://zxmvhufnxdpzzabeuxkr.supabase.co/auth/v1/callback`
   - **Create**. Copy the **Client ID** and **Client secret** (put them in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).
5. **Audience** → **Publish app** (so anyone can sign in, not just test users). Basic sign-in (email, profile) doesn't need Google verification.

**In Supabase:** **Authentication** → **Sign In / Providers** → **Google** → turn on → paste the Client ID and Client secret → **Save**.

## 6. GitHub repo and Pages (only after you approve going public)
Done by Claude with `gh`, after asking:
- `gh repo create compound --public --source . --push`
- Settings → Pages → Source **Deploy from a branch** → branch `main`, folder `/ (root)` → Save. The site appears at `https://ivorfergusson-tech.github.io/compound/` within a couple of minutes.
- Then update the Site URL in step 3.

## Checking it worked
- `node tests/run.js` checks marking, XP, locks, merging and nicknames.
- `python tools/rls_test.py` (needs `SUPABASE_SERVICE_ROLE_KEY` in `.env`) makes two throwaway accounts and checks that neither can see the other's notes or answers, that the leaderboard shows only nickname, level and XP, that claimed marks add no XP, and that deleting an account removes every row. It deletes both test accounts at the end.

## A note on cheating
The leaderboard is worked out on the server from stored attempts, and the database rejects impossible scores. Someone determined could still write fake attempts to their own account, because the site is static and the browser does the marking. That's fine for a course shared with friends. Move marking to a server function if it ever matters.
