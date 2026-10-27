# Compound: a free UK finance course

A static website that teaches personal finance, investing, paper trading and the finance industry to UK beginners of any age. 32 modules in 4 strands, quizzes in every module, 4 checkpoint tests, a glossary, XP, levels and a leaderboard. Made by Ivor Fergusson. Built from his course in `../claude v1.5/06 Learning/Finance/` (kept there as an archive).

## How to run
- Local: `python -m http.server 8000` in this folder, then open http://localhost:8000. No build step.
- Tests: `node tests/run.js` (marking, quiz engine, progress, XP, locks).
- Hosting: GitHub Pages from `main`, root folder. **Ask Ivor before pushing anything public.**

## Layout
- `index.html`: the single page. Hash routes: `#/`, `#/m/<id>`, `#/cp/<n>`, `#/glossary`, `#/leaderboard`, `#/account`, `#/about`.
- `js/`: plain ES modules, no framework. `app.js` (router, views), `content.js` (loads content), `lesson.js` (Markdown + blocks), `quiz.js` (question engine), `marking.js` (keyword marking), `calculators.js`, `charts.js` (inline SVG), `progress.js` (local progress, XP, locks, streak), `sync.js` (Supabase).
- `content/`: the course as data. Fix typos here, not in code.
  - `course.json`: every module and checkpoint in order (strand, title, level, builds on, terms).
  - `modules/<id>.md`: one lesson per module (format below).
  - `quizzes/<id>.json`: the module's quiz pool.
  - `figures.json`: every figure that changes (rates, tax bands, allowances), each with value, source, URL and `checked` date. Lessons use `{{fig:key}}`, never a typed number for these.
  - `glossary.json`: every term, its definition and the module that teaches it.
- `workflows/`: written instructions (WAT). `tools/`: helper scripts.
- `SETUP.md` (one-off Supabase and GitHub setup), `UPDATING.md` (what to refresh each April and after each Bank of England decision).

## Lesson format (`content/modules/*.md`)
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

## Quiz format (`content/quizzes/*.json`)
Types: mcq, tf, order, match, number (with `vars`, `answer` expression, `tol`), explain (`ideas` with `any` phrases; a phrase word ending in `*` matches any word starting with it). Questions sharing a `group` are alternatives (one per attempt). Every explain question needs `tests`: a right, a half-right and a wrong answer with expected marks; `node tests/run.js` checks them.

## Rules
- **Facts:** UK rules (England, Wales, NI; flag Scotland for income tax). Primary sources only (gov.uk, HMRC, Bank of England, ONS, FCA, MoneyHelper). Never invent numbers. Every changing figure lives in `figures.json` with a source and a checked date.
- **Safety:** education only, not financial advice. Trading is paper only. Every trading-strand module shows the paper-only notice.
- **Writing:** plain English, UK spelling, short paragraphs, no personal details about Ivor in lessons (general UK examples only).
- **Secrets:** only the Supabase anon (public) key goes in the site (`js/config.js`). The service key never goes in this repo. Keys live in `.env` (gitignored).
- **Privacy:** Row Level Security on every table. The public leaderboard shows nickname, level and XP only.
- Keep it free and simple: no paid services, no build step, libraries only from a CDN with exact versions.
