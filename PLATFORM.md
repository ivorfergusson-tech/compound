# Compound platform plan

Turning Compound into a free learning platform: the Money course, AQA A-level Economics (7136) and Business (7132), school classes run by teachers, and past papers. A free competitor to Uplearn and Marakoo. Agreed with Ivor on 29 Oct 2026.

Work one phase at a time (see "Build order"). Each phase is tested and shippable before the next starts. **Ask Ivor before every push.** "Later" items go in `ROADMAP.md` and are not built.

## Decisions (29 Oct 2026, from the Q&A)
These settle the open points in the brief below. Where they differ from the brief, they win.

| Topic | Decision |
|---|---|
| Pass rule with recall | Same as the current `score()`: auto + claimed marks count towards the pass; XP still counts auto marks only. Fix the XP page wording ("needs 60% from auto-marked answers") to match. |
| Recall weighting | Pool raw marks: (recall marks + quiz marks) / (recall out of + quiz out of) against `course.passMark`. Recall stays 4 questions. |
| Teacher review queue | A web page in Compound (`#/review`) for accounts Ivor marks as reviewers, protected by RLS. The local admin dashboard shows the same queue and the totals. |
| Anthropic API / legal | Not set up yet. Build P6 against a fake model. SETUP.md lists the steps and the questions for an adult (who pays for the API, who signs a DPA, whether ICO registration applies). |
| Lesson size | One lesson per lowest-level spec point (e.g. 4.1.5.4), 5–10 minutes. A module is a spec section (e.g. 4.1.5) of about 4–8 lessons, a 2–3 week teaching unit across Year 12 and 13. Very small points can be merged with a sibling, listed in the spec map for Ivor to approve. |
| Minimum bank questions | N = 6 per spec point (e.g. 3 short/MCQ, 1 calculation or explain, 1 data or 9-marker, 1 spare). 25 markers are counted per spec section, not per point. |
| Past paper links | AQA's own file where it's public, Physics & Maths Tutor where it isn't. Each paper shows its source. |
| Age check | None. |
| Money course review status | All existing Money modules and questions are `reviewed-by-owner`, dated 29 Oct 2026. |
| Support email | A new Compound address Ivor will make. Use a placeholder until then. |
| Sign-up pop-up scope | The app (`index.html`) only. The static reading pages (`m/<id>/`) stay clean for search engines; their "Open in the course" button leads into the app. |
| Supabase region | Already West EU (London), set 27 Oct 2026. No move needed. |

---

## The brief (as agreed)

### Goal
Compound is now the platform, not just the money course. A student signs up, picks a course (Money, A-level Economics or A-level Business), picks their exam board (AQA first) and learns through short lessons mapped to the exam specification, with exam-style questions marked like the real thing. Schools can put students into classes. The teacher sets the module order, sets work from a question bank and sees how each student is doing.

Why people will pick it over Uplearn and Marakoo:
- It's free.
- 9, 15 and 25 markers are AI-marked against the levels mark scheme, with feedback, and the teacher can check and change the mark.
- Students who write on paper can hand in a photo.
- Teacher tools are included: classes, assignments, analytics.
- Every real past paper is in one place, with question paper and mark scheme links and a gallery of the papers you've done.

### Audience
- **Students:** UK sixth-formers aged 16–18, mostly on phones. They want short lessons, exam technique and to know exactly what to revise.
- **Teachers:** A-level Economics and Business teachers, mostly on laptops. They want to set work in two minutes and see who is struggling with what.
- **Money course learners:** anyone, as now.

Plain English, UK spelling, short paragraphs. A-level content uses the AQA wording for terms.

### Hard rules
- Read `CLAUDE.md`, `SETUP.md` and `UPDATING.md` before touching anything.
- Keep it a static site with no build step, with CDN libraries at exact versions (no frameworks).
- **Don't break the Money course.** Keep the old URLs working (`#/m/<id>`, the reading pages at `m/<id>/`, the sitemap) or redirect them. Existing progress (localStorage `compound.progress.v1` and the Supabase tables) must carry over with nothing lost.
- **Copyright:**
  - Never host AQA question papers, mark schemes, inserts or examiner reports, or copy their question text.
  - We write our own exam-style questions.
  - The past papers section only **links** to the official files (AQA's site, or Physics & Maths Tutor as in the vault catalogue).
  - Teachers may upload their own questions, but those stay private to their class.
- **Spec from the source:** download the official AQA specs (Economics 7136, Business 7132) and build the topic map from the PDFs, citing the spec point numbers and the spec version and date. Don't work from memory.
- **Facts:** use UK primary sources (ONS, Bank of England, gov.uk, CMA, OBR) for case studies. Changing figures go in the figures.json pattern with a "checked on" date.
- **Secrets:** the Claude API key lives only in Supabase secrets, never in the browser or git.
- Safeguarding is in "Privacy and safety" below. It isn't optional.

### Courses and content
- **Course registry:** a course picker on the dashboard. Each course is completely separate, with its own modules, progress, XP breakdown, question bank and past papers. One account covers all of them.
- **Exam board:** each A-level course has a board (AQA now). Model it so Edexcel and OCR can be added later as their own spec maps with no code changes. The student picks their board when they start the course and can change it on the account page.
- **Order:** AQA Economics (7136) in full first, then AQA Business (7132).
- **Access:** the A-level courses are open to everyone but need an account with a password and a nickname. The Money course can still be used without an account.

#### Lessons (A-level)
One short lesson per spec point, 5–10 minutes each, grouped into modules that follow the spec sections. Each lesson has: Before you read (recall check), The idea in one sentence, Explanation, Key diagram, Worked exam answer (model paragraph with the analysis chains labelled), Quick checks, Exam-style questions, Key terms.

**Recall check is mandatory (all courses, Money included):**
- The module quiz can't be submitted until the recall check is done.
- Recall answers count towards the module pass mark: recall + quiz together against `course.passMark`, with the same `score()` rules.
- Questions come from earlier modules through `pickRecall`. Module 1 has no recall check; its pass is from the quiz alone.
- The result screen shows the recall and quiz parts separately, plus the combined score against the pass mark.
- On a retry, the student redoes both parts with a fresh set of recall questions. The best combined attempt counts.
- Modules already passed under the old rules stay passed.
- Update the module page text ("Score X% to pass") and the XP rules page to say recall counts.

**Interactive diagrams** (extend `js/charts.js`): supply and demand, PED/YED, tax and subsidy incidence, externalities (MPC/MSC), cost and revenue curves, market structures, AD/AS (Keynesian and classical), Phillips curve, Lorenz curve, exchange rates. Drag curves, see price, quantity, welfare areas. Light and dark mode, phones.

**Calculators** (reuse `js/calculators.js`, `calcs-*.js`): % change and index numbers, PED/XED/YED, real vs nominal, multiplier, tax incidence, profit and break-even, contribution, ratios (ROCE, gearing, current, acid test), investment appraisal (payback, ARR, NPV), decision trees.

**Exam technique lessons** for each course: command words, KAA/evaluation chains, 9/15/25 marker structure, data response, Paper 3 MCQ tactics, timing.

**Case studies:** current UK examples with sources and a "checked on" date.

#### Question bank
- Original AQA-style questions: MCQ, calculation, 2/4-mark definitions and explanations, 9/15/25-mark extended answers, data-response sets with our own short extract.
- Tags on every question: `spec`, `ao` (AO1–AO4), `command`, `marks`, `paper`, `difficulty`.
- Extended answers have a levels mark scheme (level descriptors + indicative content) and a model answer.
- Teachers can add their own questions (same format, optional image) to a private bank for their classes.
- Report button on every question ("wrong answer / typo / unclear"), feeding the admin dashboard.

#### Accuracy
Claude writes everything from the spec. A test fails if any spec point has no lesson or fewer than N questions. Ivor reads and approves each module before it's published.

### Accounts and nicknames
- Email + password sign-up, "Forgot password?" by email. Keep Google. Magic link only for resets (or drop it). Passwords at least 8 characters, with Supabase's leaked-password check if available.
- Nicknames unique (case-insensitive), with the existing filter (`js/nickname.js` + `nickname_ok`).
  - Locked for 7 days after being set or changed, enforced in SQL (`nickname_changed_at`).
  - Account page shows "You can change your nickname in 5 days".
  - A teacher can force-reset an inappropriate nickname for a student in their class; the student picks a new one and the reset doesn't count towards the lock.
- Teachers: an "I'm a teacher" tick at sign-up. Tools unlock straight away, account **unverified** until Ivor approves it. `.sch.uk`, `.ac.uk` and an editable list are verified automatically. Unverified: a class is limited to 35 students.

### Sign-up pop-up (Money course)
- First visit: a "Create an account" pop-up (email + password or Google) with a cross and "Continue without an account". One line: "Track your progress from the start".
- If dismissed: one banner after their first quiz ("Save your progress? Make a free account"), then never again. Progress merges on sign-up (`mergeStates`).
- A-level courses: the pop-up appears without the "continue" option.

### Student dashboard
- Course picker cards with a % complete bar.
- My classes: assignments, % done, due dates, marks. Join a class (code, link or QR).
- Due soon at the top, then Continue where you left off.
- Refresh knowledge: a quick set from questions got wrong in other modules (`srs` / `pickRecall`), across every course.
- Exam countdown: exam dates, days left, a suggested weekly plan from weakest topics.
- Class leaderboard (XP inside the class only; teacher can turn it off). Public leaderboard unchanged.
- XP, levels and streaks carry across all courses.

### Classes (teachers)
- Create a class (name, course, board, year group): 6-character join code, join link, QR. Make a new code or close joining.
- A student can be in several classes; a teacher can run several.
- Joining needs an account. Consent screen: "Your teacher will see your real name, your scores, time spent and work you hand in." Real name per class. Leave any time; teacher keeps past marks but gets no new data.
- Teacher sets module order and can lock modules until released. Students outside a class learn in any order.

### Assignments
- From lessons, bank questions, the teacher's own questions or a real past paper.
- Set date and due date, late flag, who hasn't finished; max attempts; timed mode; mock papers from the bank.
- Save midway: autosave as they type (Supabase, localStorage backup offline). In timed mode the clock keeps running (teacher's choice).
- Paper hand-in: photograph each page, Claude reads the handwriting, student confirms or fixes the typed version, then it's marked. Teacher sees photo, text and mark side by side.

### Marking
- Auto-marked: MCQ, calculations and short answers, as now.
- AI-marked: 9, 15 and 25 markers by Claude against the levels mark scheme: level and mark, what earned marks, what was missing, one thing to do next time. Teacher can change the mark and comment; the teacher's mark is final. AI marks are labelled as estimates.
- Cost control: Edge Functions `mark-answer` and `read-handwriting`, latest Sonnet model. Daily cap 5 AI marks per student (teacher-set work not counted or capped separately). Hard monthly budget (start £10). When a cap is hit, the student self-marks against the mark scheme and model answer. Usage and spend on the admin dashboard.

### Teacher analytics
- Per assignment: status, mark, tries, active time (paused when hidden or idle 2 min), start/finish, late.
- Topic heatmap (class × spec topic, % score). Per question: % correct, most common wrong answer, average time.
- Student profile: progress, streak, last active, weakest topics, marks over time, working-at grade (estimate).
- CSV export.

### Past papers (each A-level course)
Modelled on the HUD School tab (`03 School/Papers/catalogue.md`, `paperGallery()` in the HUD plugin).
- Catalogue: every past paper for the current spec, by subject and board. ID (e.g. `E-J19-P1`), series, paper name, links to QP, MS and insert; oldest first, specimens last. Links only. A test checks every link responds.
- Next paper card: next undone paper, QP and MS buttons, Log marks. Weekly paper day.
- Log marks per question (or photos, AI-marked). Questions tagged with spec topics, so lost marks feed Weakest topics. Consolidation questions from the bank, tracked "Consolidation x/y".
- Paper gallery: card per paper done, newest first (subject chip, date, %, score/out of, grade-coloured bar, top 2 topics lost, consolidation). Filter by subject; click to reopen.
- Rough grade from the last 3 papers using published boundaries (linked, date checked).
- Teachers can reserve papers (hidden from the class's practice list) and set a real past paper as an assignment.

### Privacy and safety
- Update `privacy.html`: teacher visibility, AI marking (sent to Anthropic for marking, not used for training), photo storage and deletion, leaving a class, deleting your account.
- Photos in a private Storage bucket, readable only by the student and their teacher, deleted 90 days after marking.
- RLS on every new table: a teacher sees only their classes' students and only from each student's join date; a student sees only their own work; real names never public.
- Admin dashboard: teacher approvals, question reports, AI usage and spend, class and student counts.
- Paid plans later: keep the model ready (e.g. a `plan` field on classes), build nothing paid.

### Closing the gap with Uplearn and Seneca (build only "Now")
1. **Data protection paperwork.** Now: `schools/` pages (data map, sub-processor list, DPIA template, DPA template, safeguarding and contact). Flag what needs an adult or company and whether ICO registration applies, as questions for Ivor. Later: Cyber Essentials, DfE and LGfL buying lists.
2. **School systems.** Now: Microsoft sign-in (Supabase Azure), CSV roster import with invites, Share to Teams / Google Classroom. Later: Wonde MIS sync, school SSO.
3. **Who wrote it.** Now: review status on every lesson and question (`ai-draft` → `reviewed-by-owner` → `reviewed-by-teacher`), shown per module with reviewer name, role and date (with permission); teacher review queue; public corrections log. Nothing reaches students below `reviewed-by-owner`. Aim: Ivor's teachers review module 4.1 before any outside school sees it.
4. **Proof it works.** Now: pilot mode (baseline quiz, same-standard quiz after 6 weeks), impact report. Real numbers only, no promises. Later: case study page.
5. **Number of subjects.** Now: a subject kit (checklist, templates, scaffold script) so a new subject or board is content only. Test by scaffolding an empty "AQA Business" before P10. Later: GCSE, other boards.
6. **Video and animation.** Now: step-through diagrams with captions, pause and step back, read-aloud. Later: YouTube explainers.
7. **Human help.** Now: Ask my teacher (inbox, reply shows on the item); Explain this (AI, same caps). Later: peer help, tutoring.
8. **Accessibility (every phase).** WCAG 2.2 AA. Read aloud (Web Speech API), dyslexia-friendly font, spacing, text size, high contrast (saved per account), full keyboard use and visible focus, alt text + text description on every diagram, extra time 25%/50% per student, glossary hover. axe-core in browser tests; any serious issue fails.
9. **Parent view.** Now: read-only parent link (student's choice, cancellable), printable progress report. Later: weekly parent emails.
10. **Phone app.** Now: PWA (manifest, icons, service worker, offline reading of opened lessons, offline answers sync). Later: store wrappers.
11. **Support and reliability.** Now: help centre, teacher quick start, support email, free uptime monitor and status note, cost sheet in SETUP.md, AI budget per class. Later: Supabase Pro and a paid school plan (ask first).

### Architecture (suggested; check against the code)
- `content/courses/<course>/{course.json, modules/, quizzes/, papers.json}`, `course.json` carrying `board`, `spec`, `specVersion`. Money migrated into `content/courses/money/`.
- Routes `#/c/<course>/m/<id>` and `#/c/<course>/papers`; old Money routes redirected. `tools/build_pages.mjs` and the sitemap follow.
- Quiz format: add `long` (levels mark scheme, model answer) and `data` (extract + questions), plus tag fields. Existing types unchanged.
- Supabase tables: `teachers`, `classes`, `class_members`, `class_modules`, `assignments`, `assignment_items`, `submissions`, `answers`, `ai_marks`, `teacher_questions`, `paper_attempts`, `reserved_papers`, `reports`, `ai_usage`. Profile fields `nickname_changed_at`, `role`, `boards`. Class leaderboard view respecting the teacher's switch.
- Edge Functions `mark-answer`, `read-handwriting`: check auth, class membership and caps, log to `ai_usage`, return structured JSON.
- Likely new files: `js/classes.js`, `js/teacher.js`, `js/assign.js`, `js/papers.js`, `js/dash.js`.

### Build order
- **P0 Multi-course restructure:** course registry, folder layout, routes and redirects, Money migrated, mandatory recall counted in the pass, all existing tests passing.
- **P1 Accounts:** password sign-up and reset, Microsoft sign-in, nickname uniqueness and 7-day lock, sign-up pop-up and banner, display and accessibility settings.
- **P2 Dashboard:** course picker with % bars, continue, refresh knowledge, exam countdown.
- **P3 AQA Economics:** spec map first (Ivor checks), then 4.1 modules with diagrams, calculators, bank and exam technique (Ivor reviews each), then 4.2.
- **P4 Teachers and classes:** sign-up and verification, classes, codes, link and QR, consent, real names, module order and locks, class leaderboard.
- **P5 Assignments:** builder, due dates, late flags, attempts, timed mode, mock papers, autosave and resume, teacher question bank.
- **P6 AI marking and photo hand-in:** Edge Functions, caps and budget, teacher override, photo deletion.
- **P7 Analytics:** time, tries, heatmap, per-question, student profile, grade estimate, CSV.
- **P8 Past papers:** catalogue and link checker, next paper, log marks, topic tags, weakest topics, consolidation, gallery, reserved papers, past paper as assignment.
- **P9 Privacy, reports and admin.**
- **P10 AQA Business (7132).**
- **P11 School-ready pack:** `schools/` pages, roster import, share buttons, Ask my teacher, Explain this, parent link, printable report, PWA, help centre, quick start, uptime monitor, cost sheet.
- **P12 Pilot:** pilot mode with one real class, then the impact report from real results.

Across all phases: read-aloud, step-through diagrams, review statuses, the subject kit (before P10).

### Tests (every phase)
- `node tests/run.js`: spec coverage; question schema and tags; levels mark schemes; nickname lock rules; merging progress across courses; Money progress migration; papers.json shape and links; module pass includes recall, quiz can't be submitted without recall, module 1 exempt, old passes kept; nothing below `reviewed-by-owner` published; every diagram has alt text and a text description; the subject kit scaffolds a course that passes the schema tests.
- `tools/rls_test.py`: teacher can't see another class or a student from before they joined; student can't see others' work; a student who leaves stops sending data; photos are private.
- Browser tests (port 8765): sign-up pop-up and dismiss, password sign-up, join by code, autosave and resume, timed mode, photo upload, teacher analytics, phone width, axe-core, PWA install and offline reading, CSV roster import, parent link read-only and cancellable.
- Edge Functions: fake model response, caps, budget-hit fallback.

### Things to watch
- Supabase free tier limits (storage, function calls, database size). Compress photos before upload.
- AI marks stay advisory, labelled, teacher wins.
- Class leaderboards count only XP from that class's work.
- Spec changes: store `specVersion`, add a check to UPDATING.md.
- Workload: this comes after Beemz and revision, not instead of them.
