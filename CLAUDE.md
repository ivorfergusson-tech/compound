# Compound: a free UK learning platform

A static website. It started as a finance course (personal finance, investing, paper trading and the finance industry for UK beginners of any age: 32 modules in 4 strands, quizzes, 4 checkpoint tests, a glossary, XP, levels and a leaderboard) and is becoming a free platform with AQA A-level Economics and Business, school classes and past papers. **The plan, the build order and the decisions are in `PLATFORM.md`; read it before platform work.** Later ideas go in `ROADMAP.md`. Made by Ivor Fergusson. The Money course was built from his course in `../claude v1.5/06 Learning/Finance/` (kept there as an archive).

## How to run
- Local: `python -m http.server 8000` in this folder, then open http://localhost:8000. No build step.
- Tests: `node tests/run.js` (marking, quiz engine, progress, XP, locks, recall, course registry, progress keys). Browser tests (serve on port 8765 first): `python tests/browser_test.py`, `python tests/render_all.py`, `python tests/checkpoint_test.py`, `python tests/recall_test.py` (routes, redirects, the recall check), `python tests/dashboard_test.py` (dashboard, refresh knowledge, exam countdown), `python tests/econ_test.py` (the A-level Economics lessons, checkpoints and guides), `python tests/classes_test.py` (joining, consent and the teacher pages, with a faked database), `node tools/classes_sql_test.mjs supabase/schema.sql` (the class rules attacked in a throwaway Postgres; needs `npm i --no-save @electric-sql/pglite@0.2.17`), `python tests/accounts_test.py` (sign-up pop-up and banner, sign-in forms with faked Supabase answers, A-level account gate, display settings, read aloud, keyboard, and axe-core on the main pages: any serious accessibility issue fails). `python tools/rls_test.py` checks the live database rules (privacy, nickname lock, XP).
- Hosting: GitHub Pages from `main`, root folder. **Ask Ivor before pushing anything public.** If `supabase/schema.sql` changed, Ivor runs it in Supabase before the push.

## Layout
- `index.html`: the single page. Hash routes: `#/` (the dashboard: continue, course cards, refresh knowledge, exam countdown), `#/refresh`, `#/c/<course>` (a course's map), `#/c/<course>/m/<id>`, `#/c/<course>/cp/<n>`, `#/c/<course>/glossary`, `#/leaderboard`, `#/account`, `#/about`. Old Money links (`#/m/<id>`, `#/cp/<n>`, `#/glossary`) redirect to `#/c/money/…`; keep that working.
- `js/`: plain ES modules, no framework. `app.js` (router, views), `content.js` (loads the registry and each course's files), `lesson.js` (Markdown + blocks), `quiz.js` (question engine), `quizui.js` (question cards, quiz runner), `marking.js` (keyword marking), `calculators.js`, `charts.js` (inline SVG), `progress.js` (local progress, XP, locks, streak), `sync.js` (Supabase: sign-in forms, sync, leaderboard), `nickname.js` (nickname filter, 7-day lock, password rules), `display.js` (font, spacing, text size, contrast, theme), `modal.js` (accessible pop-up), `speech.js` (read aloud).
- `content/`: the courses as data. Fix typos here, not in code.
  - `courses.json`: the course registry (id, subject, board, folder, reading-pages folder, live). A new course or exam board is a new row and folder, no code.
  - `courses/<id>/course.json`: every module and checkpoint in order (strand, title, level, builds on, terms), plus `id`, `board`, `spec`, `specVersion`, `passMark` and `review` (status `ai-draft` / `reviewed-by-owner` / `reviewed-by-teacher`, who, role, date; an item can override it). Nothing below `reviewed-by-owner` may be in `ready`; `node tests/run.js` checks.
  - `courses/<id>/modules/<id>.md`: one lesson per module (format below).
  - `courses/<id>/quizzes/<id>.json`: the module's quiz pool.
  - `courses/<id>/glossary.json`: every term, its definition and the module that teaches it.
  - `figures.json` (shared by all courses): every figure that changes (rates, tax bands, allowances), each with value, source, URL and `checked` date. Lessons use `{{fig:key}}`, never a typed number for these.
- **Progress keys:** one progress state (localStorage `compound.progress.v1`, Supabase tables) covers every course. Money keeps its bare ids (`01`, `cp1`, `"legacyIds": true`); every other course's keys are `<course>:<id>` (`itemKey()` in `progress.js`). Never rename Money ids.
- **Recall check:** every module from 2 on starts with a recall check from earlier modules (`pickRecall`). The quiz can't start without a fresh one, and the pass is (recall marks + quiz marks) / (both totals) against `passMark`, with the usual `score()` rules. The quiz attempt stores its own marks in `auto`/`claimed`/`outOf` (XP counts those) plus `recall: {auto, claimed, outOf}`; `passed`/`autoPassed` count both. Old passes stay passed.
- `m/<id>/index.html`, `m/index.html`, `sitemap.xml`: generated reading versions of each Money lesson so search engines can index them (hash routes are invisible to Google). **After changing any lesson, figure, glossary entry, course.json or courses.json, run `node tools/build_pages.mjs`**; `node tests/run.js` fails if they're out of date. Never edit them by hand.
- `img/share.png`: link-preview card (`python tools/make_share_image.py`).
- `workflows/`: written instructions (WAT). `tools/`: helper scripts.
- `SETUP.md` (one-off Supabase and GitHub setup), `UPDATING.md` (what to refresh each April and after each Bank of England decision).

## Lesson format (`content/courses/<id>/modules/*.md`)
Normal Markdown, plus:
- `## Heading` starts a section. Reading progress and quick checks hang off sections.
- `[[term]]` or `[[term|shown text]]`: a tappable glossary term (key must exist in `glossary.json`).
- `{{fig:key}}` prints a figure from `figures.json` with its "checked on" note.
- Blocks, on their own lines:
  ```
  :::check
  { one question in the quiz JSON format }
  :::
  :::calc compound {"p":1500,"r":4.5,"y":10}
  :::
  :::chart inflation {"p":1500,"cpi":3.5,"years":10}
  :::
  :::guess {"prompt":"Your guess", "unit":"£"}
  :::
  :::callout idea
  Text
  :::
  ```

## Quiz format (`content/courses/<id>/quizzes/*.json`)
Types: mcq, tf, order, match, number (with `vars`, `answer` expression, `tol`), explain (`ideas` with `any` phrases; a phrase word ending in `*` matches any word starting with it). Questions sharing a `group` are alternatives (one per attempt). Every explain question needs `tests`: a right, a half-right and a wrong answer with expected marks; `node tests/run.js` checks them.

## Rules
- **Facts:** UK rules (England, Wales, NI; flag Scotland for income tax). Primary sources only (gov.uk, HMRC, Bank of England, ONS, FCA, MoneyHelper). Never invent numbers. Every changing figure lives in `figures.json` with a source and a checked date.
- **Safety:** education only, not financial advice. Trading is paper only. Every trading-strand module shows the paper-only notice.
- **Writing:** plain English, UK spelling, short paragraphs, no personal details about Ivor in lessons (general UK examples only).
- **Secrets:** only the Supabase anon (public) key goes in the site (`js/config.js`). The service key never goes in this repo. Keys live in `.env` (gitignored).
- **Privacy:** Row Level Security on every table. The public leaderboard shows nickname, level and XP only.
- Keep it free and simple: no paid services, no build step, libraries only from a CDN with exact versions.
- **Accessibility (WCAG 2.2 AA), every phase:** keyboard use with visible focus, labels on every control, text sizes in `rem` (never px) so the text-size setting works, colours from the theme tokens (they have high-contrast versions), alt text plus a text description on every diagram. Run `tests/accounts_test.py` (axe-core) before shipping.
- **Accounts:** email + password (confirmed by email), Google, Microsoft. Nicknames are unique, filtered, and locked for 7 days after a change (enforced in SQL by `nickname_lock`). The sign-up pop-up shows once on a first visit (`compound.signup` in localStorage), then one banner after the first quiz. Courses with `needsAccount` in `courses.json` need an account with a nickname.
