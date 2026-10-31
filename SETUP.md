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

**Run it again whenever `schema.sql` changes, before the site is pushed.** The site sends every column the file defines, so pushing first makes syncing fail until the SQL is run (progress stays safe in each browser meanwhile). Changes so far:
- 29 Oct 2026 (platform P0): `attempts` gets `recall_auto`, `recall_claimed`, `recall_out_of` (the recall check part of a module quiz), and item ids may be course-prefixed (`econ-aqa:4.1.5`). Existing rows are untouched.
- 29 Oct 2026 (platform P1): the nickname lock (`nickname_changed_at`, `nickname_must_change` on profiles, and the `nickname_lock` trigger: 7 days between changes, enforced by the database), and a `settings` table for display settings. Existing nicknames start unlocked.
- 30 Oct 2026 (platform P2): an `exams` column on `settings` for the exam dates learners add on the dashboard (up to 12, size-limited by the database).

## 3. Sign-in links point at the right site
Left sidebar → **Authentication** → **URL Configuration**:
- **Site URL:** `https://ivorfergusson-tech.github.io/compound/` (once GitHub Pages is on; until then `http://127.0.0.1:8765/`).
- **Redirect URLs** → **Add URL**, one at a time:
  - `http://127.0.0.1:8765/**`
  - `http://localhost:8765/**`
  - `https://ivorfergusson-tech.github.io/compound/**`
- **Save**.

## 4. Email and password sign-in
People sign up with an email and a password (and confirm their email by link), or with Google or Microsoft. "Forgot password?" emails a reset link. The old email sign-in link is gone from the site; anyone who used it chooses "Forgot password?" to set a password.

In Supabase → **Authentication**:
- **Sign In / Providers** → **Email**: **Enable email provider** on, **Confirm email** on (it is: checked 29 Oct 2026).
- **Sign In / Providers** → **Email** (or **Policies / Passwords**, depending on the dashboard version): **Minimum password length** `8`. If **Leaked password protection** is offered on your plan, turn it on; at the time of writing Supabase lists it for paid plans, so on the free plan the site's own checks (8+ characters, no common passwords) are what applies.
- **URL Configuration**: the redirect URLs from step 3 already cover the reset link (`…/compound/?reset=1`).

Emails: Supabase's built-in email only sends a few emails an hour, which is fine for testing. Before sharing widely, send them through Brevo (free, 300 a day):
- Brevo → **SMTP & API** → **SMTP** tab → note the server, port, login and generate an SMTP key.
- Supabase → **Authentication** → **Emails** → **SMTP Settings** → turn on **Enable custom SMTP**: host `smtp-relay.brevo.com`, port `587`, your Brevo login and SMTP key, sender name `Compound`, sender email one you've verified in Brevo → **Save**.

## 5. Google sign-in
**In Google Cloud** (console.cloud.google.com, signed in with your Google account):
1. Top bar project picker → **New project** → name `Compound` → **Create**, then select it.
2. Search bar → **Google Auth Platform** (or **APIs & Services → OAuth consent screen**) → **Get started**:
   App name `Compound`, support email yours → **Next** → Audience **External** → **Next** → contact email yours → **Next** → agree → **Create**.
3. **Branding**: app name `Compound`, support email yours, **no logo** (a logo triggers a Google review), home page `https://ivorfergusson-tech.github.io/compound/`, privacy policy `https://ivorfergusson-tech.github.io/compound/privacy.html`, authorised domains `zxmvhufnxdpzzabeuxkr.supabase.co` and `ivorfergusson-tech.github.io` (Google wants the full project address, not `supabase.co`), developer email yours → **Save**.
4. **Clients** → **+ Create client** → type **Web application**, name `Compound web`.
   - **Authorised redirect URIs** → **+ Add URI** → `https://zxmvhufnxdpzzabeuxkr.supabase.co/auth/v1/callback`
   - **Create**. Copy the **Client ID** and **Client secret** (put them in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).
5. **Audience** → **Publish app** (so anyone can sign in, not just test users). Basic sign-in (email, profile) doesn't need Google verification.

**In Supabase:** **Authentication** → **Sign In / Providers** → **Google** → turn on → paste the Client ID and Client secret → **Save**.

## 5b. Microsoft sign-in (many schools use Microsoft 365 and Teams)
The "Continue with Microsoft" button appears on the site by itself once this is switched on. Free; a personal Microsoft account is enough to set it up.

**In Azure** (portal.azure.com, signed in with your Microsoft account):
1. Search bar → **Microsoft Entra ID** → **App registrations** → **+ New registration**.
2. Name `Compound`. Supported account types: **Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts**. Redirect URI: platform **Web**, `https://zxmvhufnxdpzzabeuxkr.supabase.co/auth/v1/callback` → **Register**.
3. On the app's **Overview**, copy the **Application (client) ID** → `.env` as `AZURE_CLIENT_ID`.
4. **Certificates & secrets** → **+ New client secret** → description `Supabase`, expiry 24 months → **Add**. Copy the **Value** straight away (it's shown once; not the "Secret ID") → `.env` as `AZURE_CLIENT_SECRET`. Note the expiry date: sign-in with Microsoft stops when it runs out, so make a new one before then.

**In Supabase:** **Authentication** → **Sign In / Providers** → **Azure** → turn on → paste the client ID and secret, leave **Azure Tenant URL** empty (so any school or personal account works) → **Save**.

Some schools only let pupils use apps their IT team has approved. If a student sees "Need admin approval", their school's IT admin has to approve Compound once for the whole school; until then the student can use email and password.

## 6. GitHub repo and Pages (done 27 Oct 2026)
Done by Claude with `gh`, after asking:
- `gh repo create compound --public --source . --push`
- Settings → Pages → Source **Deploy from a branch** → branch `main`, folder `/ (root)` → Save. The site appears at `https://ivorfergusson-tech.github.io/compound/` within a couple of minutes.
- Then update the Site URL in step 3.

## Checking it worked
- `node tests/run.js` checks marking, XP, locks, merging and nicknames.
- `python tools/rls_test.py` (needs `SUPABASE_SERVICE_ROLE_KEY` in `.env`) makes two throwaway accounts and checks that neither can see the other's notes or answers, that the leaderboard shows only nickname, level and XP, that claimed marks add no XP, and that deleting an account removes every row. It deletes both test accounts at the end.

## A note on cheating
The leaderboard is worked out on the server from stored attempts, and the database rejects impossible scores. Someone determined could still write fake attempts to their own account, because the site is static and the browser does the marking. That's fine for a course shared with friends. Move marking to a server function if it ever matters.

## 7. Admin preview account and private dashboard
- **Admin account:** sign in on the live site with a second account (use a private window so your own progress isn't touched). Don't pick a nickname. Then add it in Supabase → **SQL Editor**: `insert into public.admins (user_id) select id from auth.users where email = 'that@email';` Signed in as admin, everything is unlocked, nothing is saved, and it never shows on the leaderboard.
- **Dashboard:** `python tools/admin_dashboard.py` writes `.tmp/admin.html` (gitignored) from the live database and opens it. Accounts, how each module is going, most-missed topics. It never goes online.

## Teachers and classes (P4)

Run `supabase/schema.sql` again before pushing this code. Then:

- **Verify a teacher by hand:** SQL Editor → `update public.teachers set status = 'verified', verified_at = now() where user_id = (select id from auth.users where email = 'them@example.com');`
- **See who's waiting:** `select u.email, t.display_name, t.school, t.created_at from public.teachers t join auth.users u on u.id = t.user_id where t.status = 'unverified';`
- **Trust another email domain:** `insert into public.teacher_domains (domain) values ('trust.org.uk');` Any confirmed address at that domain or below it is verified automatically. `.sch.uk` and `.ac.uk` already are.
- **Test the rules without touching Supabase:** `npm i --no-save @electric-sql/pglite@0.2.17`, then `node tools/classes_sql_test.mjs supabase/schema.sql`.

