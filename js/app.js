// Router and views. Hash routes: #/ (dashboard), #/refresh, #/c/<course>, #/c/<course>/m/<id>, #/c/<course>/cp/<n>,
// #/c/<course>/glossary, #/leaderboard, #/account, #/about. The old Money routes (#/m/<id>, #/cp/<n>, #/glossary)
// redirect to #/c/money/….
import { esc, el, niceDate } from './util.js';
import { loadRegistry, loadFigures, courseFiles } from './content.js';
import { Progress, courseStatus, levelFor, pickRecall, itemKey, attemptPct, XP_RULES, unitOf, planItems } from './progress.js';

import { viewClasses, viewJoin, viewClassBoard, viewTeach, viewTeachClass } from './classes.js';

const UnitOf = c => (unitOf(c) === 'lesson' ? 'Lesson' : 'Module');
import { REFRESH_ID, lastActive, nextItem, coursePercent, srsModules, pickRefresh, weakSpots, upcoming, weekPlan } from './dashboard.js';
import * as exams from './exams.js';
import { buildAttempt, buildCheckpoint, instantiate } from './quiz.js';
import { runQuiz } from './quizui.js';
import { parseLesson, hydrateBlocks } from './lesson.js';
import * as sync from './sync.js';
import * as display from './display.js';
import { openModal } from './modal.js';
import { canSpeak, speak, pause, resume, stop as stopSpeaking, textOf } from './speech.js';

const progress = new Progress();
const app = document.getElementById('app');
// The course being shown: its registry entry, file loaders, course.json and glossary.
let registry, figures, entry, files, course, glossary;
let cleanup = [];
const loaded = new Map();

function loadCourseById(id) {
  const e = registry.courses.find(c => c.id === id && (c.live || (c.preview && sync.isAdmin())));
  if (!e) return Promise.resolve(null);
  if (!loaded.has(id)) {
    const f = courseFiles(e);
    loaded.set(id, Promise.all([f.course(), f.glossary()]).then(([c, g]) => ({ entry: e, files: f, course: c, glossary: g })));
  }
  return loaded.get(id);
}

// A student in a class sees that class's order. The course on file is never changed.
const withPlan = c => { const plan = sync.planFor(c.id); return plan ? { ...c, items: planItems(c.items, plan) } : c; };

async function useCourse(id) {
  const c = await loadCourseById(id);
  if (!c) return false;
  ({ entry, files, glossary } = c);
  course = withPlan(c.course);
  return true;
}

// ---------- theme and display settings (js/display.js) ----------
display.apply(display.get());
function cycleTheme() {
  display.set({ theme: display.get().theme === 'dark' ? 'light' : 'dark' });
  const form = app.querySelector('.settings-grid');
  if (form) form.querySelector(`input[name=theme][value=${display.get().theme}]`).checked = true;
}

// ---------- sign-up pop-up ----------
// First visit: a "Create an account" pop-up that can be closed. If closed, one banner after the first
// quiz, then never again. compound.signup: '' (not shown yet) | 'dismissed' | 'bannered' | 'done'.
const SIGNUP_KEY = 'compound.signup';
const signupFlag = () => { try { return localStorage.getItem(SIGNUP_KEY) || ''; } catch { return 'done'; } };
const setSignupFlag = v => { try { localStorage.setItem(SIGNUP_KEY, v); } catch { /* blocked */ } };
let modal = null;
const hasDoneAnything = () => progress.state.attempts.length > 0 || Object.keys(progress.state.read).length > 0;

// required: the A-level courses, which need an account (no "continue without" button).
async function showSignup({ required = false } = {}) {
  if (modal && modal.isOpen()) return;
  const lead = required
    ? '<p>This course needs a free account with a nickname, so your progress and marks are kept safe.</p>'
    : '<p>Track your progress from the start. Free, and it works on any device.</p>';
  const html = await sync.authForm('signup', { lead })
    + (required ? '' : '<button type="button" class="btn ghost wide continue">Continue without an account</button>');
  modal = openModal(html, {
    label: 'Create an account',
    onClose: why => {
      if (why === 'signed-in') return;
      if (required) { if (location.hash.startsWith('#/c/')) location.hash = '#/'; return; }
      if (!signupFlag()) setSignupFlag('dismissed');
    },
  });
  sync.wireAuthForm(modal.box, {
    lead,
    onSignedIn: () => { setSignupFlag('done'); modal.close('signed-in'); route(); },
  });
  modal.box.querySelector('.continue')?.addEventListener('click', () => modal.close('continue'));
}

function maybeShowSignup(parts) {
  if (!sync.available() || sync.signedIn() || parts[0] === 'account' || signupFlag() || hasDoneAnything()) return;
  showSignup();
}

// The one gentle reminder, after the first quiz once the pop-up has been closed.
function saveBanner() {
  if (!sync.available() || sync.signedIn() || signupFlag() !== 'dismissed') return '';
  setSignupFlag('bannered');
  return '<div class="save-banner"><p><strong>Save your progress?</strong> Make a free account and keep it on any device.</p><a class="btn" href="#/account">Make a free account</a></div>';
}

// ---------- shared bits ----------
const strandOf = item => (item.strand ? course.strands[item.strand] : null);
const itemById = id => course.items.find(i => i.id === id);
const K = id => itemKey(course, id); // progress key for an item of this course
const base = () => `#/c/${course.id}`;
const hrefItem = it => (it.kind === 'checkpoint' ? `${base()}/cp/${it.num}` : `${base()}/m/${it.id}`);

function statusMap() { return courseStatus(course.items, progress, course.ready, { unit: unitOf(course), unlockAll: sync.isAdmin(), key: K, plan: sync.planFor(course.id) }); }

function gameStrip() {
  const xp = progress.xp().total;
  const lv = levelFor(xp);
  const rank = sync.myRank();
  const pct = Math.round((lv.into / lv.need) * 100);
  const banner = sync.isAdmin() ? '<a class="admin-banner" href="#/account">Admin preview · everything unlocked · nothing saved</a>' : '';
  return banner + `<a class="strip" href="#/leaderboard" aria-label="Level ${lv.level}, ${lv.into} of ${lv.need} XP to next level, ${progress.streak()} day streak${rank ? `, rank ${rank}` : ''}. Open leaderboard">
    <span class="lv">Lv ${lv.level}</span>
    <span class="xpbar"><span class="track"><span style="width:${pct}%"></span></span><span class="xptext">${xp} XP · ${lv.to - xp} to level ${lv.level + 1}</span></span>
    <span class="streak" title="Days in a row">🔥 ${progress.streak()}</span>
    <span class="rank">${rank ? `#${rank}` : '🏆'}</span>
  </a>`;
}

function refreshStrip() {
  const s = document.querySelector('.strip');
  document.querySelector('.admin-banner')?.remove();
  if (s) s.outerHTML = gameStrip();
}

function shell(main, { title, wide } = {}) {
  document.title = title ? `${title} · Compound` : 'Compound: a free UK finance course';
  app.innerHTML = `
    <header class="top">
      <a class="brand" href="#/"><span class="logo" aria-hidden="true">£</span><span>Compound</span></a>
      <nav class="top-nav" aria-label="Main">
        <a href="${base()}/glossary" class="icon-link" aria-label="Glossary"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M6.5 17A2.5 2.5 0 0 0 4 19.5 2.5 2.5 0 0 0 6.5 22H20v-5"/></svg></a>
        <button type="button" class="icon-link theme-btn" aria-label="Switch light or dark mode"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button>
        <a href="#/account" class="icon-link" aria-label="Account"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg></a>
      </nav>
    </header>
    <div class="read-progress" hidden><span></span></div>
    ${gameStrip()}
    <main class="page${wide ? ' page-wide' : ''}">${main}</main>
    <footer class="foot">
      <p><strong>Education only, not financial advice.</strong> Trading in this course is paper only.</p>
      <p>UK rules (England, Wales and Northern Ireland; Scotland flagged where income tax differs). Every changing figure shows when it was checked.</p>
      <p>Made by Ivor Fergusson · <a href="${esc(entry.pages)}">All lessons</a> · <a href="#/about">About and sources</a> · <a href="privacy.html">Privacy</a></p>
    </footer>`;
  app.querySelector('.theme-btn').addEventListener('click', cycleTheme);
  window.scrollTo(0, 0);
}

function lockIcon() {
  return `<svg class="lock" viewBox="0 0 24 24" role="img" aria-label="Locked"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
}

function itemCard(item, s) {
  const strand = strandOf(item);
  const locked = s.state === 'locked' || (s.state === 'soon' && !sync.isAdmin());
  const href = hrefItem(item);
  const icon = item.kind === 'checkpoint' ? '✏️' : item.kind === 'intro' ? '👋' : strand.emoji;
  const kicker = item.kind === 'checkpoint' ? `Checkpoint · ${unitOf(course)}s ${item.covers[0]}–${item.covers[1]}`
    : item.kind === 'intro' ? 'Start here' : item.kind === 'guide' ? strand.name : `${item.num} · ${strand.name}${item.strand === 'trading' ? ' (paper only)' : ''}`;
  const right = s.state === 'locked' ? lockIcon()
    : s.state === 'soon' ? '<span class="tag">Soon</span>'
    : s.state === 'passed' ? `<span class="tag good">Passed${s.best != null ? ` · ${s.best}%` : ''}</span>`
    : s.state === 'done' ? '<span class="tag good">Done</span>'
    : s.best != null ? `<span class="tag warm">${s.best}% · retake</span>` : '<span class="tag accent">Start</span>';
  const inner = `<span class="ic strand-${item.strand || item.kind}" aria-hidden="true">${icon}</span>
    <span class="txt"><span class="kicker strand-text-${item.strand || item.kind}">${esc(kicker)}</span><span class="name">${esc(item.short || item.title)}</span>${locked ? `<span class="why-locked">${esc(s.reason)}</span>` : ''}</span>${right}`;
  return locked
    ? `<div class="item locked ${item.kind}">${inner}</div>`
    : `<a class="item ${item.kind} ${s.state === 'open' && s.best == null && item.kind !== 'intro' && item.kind !== 'guide' ? 'current' : ''}" href="${href}">${inner}</a>`;
}

// ---------- views ----------
function viewHome(params) {
  const st = statusMap();
  const filter = params.get('strand') || 'all';
  const modules = course.items.filter(i => i.kind === 'module');
  const passedCount = modules.filter(i => st[i.id].state === 'passed').length;
  const fresh = !course.items.some(i => progress.state.read[K(i.id)] || progress.attemptsFor(K(i.id)).length);
  const next = nextItem(course, st, !fresh) || course.items[0];
  const nextStrand = strandOf(next);
  const ns = st[next.id];

  const levels = ['Start here', 'Beginner', 'Intermediate', 'Advanced', 'Expert', 'Exam technique'];
  let lastLevel = null;
  let list = '';
  for (const item of course.items) {
    if (filter !== 'all' && item.strand !== filter) continue;
    const lvl = item.level || lastLevel;
    if (item.kind !== 'checkpoint' && lvl !== lastLevel && levels.includes(lvl)) {
      list += `<h3 class="section-label">${esc(lvl === 'Expert' ? 'Capstones' : lvl)}</h3>`;
      lastLevel = lvl;
    }
    list += itemCard(item, st[item.id]);
  }

  const chips = [['all', 'All', '']].concat(Object.entries(course.strands).map(([k, s]) => [k, s.name, s.emoji]))
    .map(([k, name, emoji]) => `<a class="chip strand-chip-${k} ${filter === k ? 'on' : ''}" href="${base()}${k === 'all' ? '' : '?strand=' + k}" ${filter === k ? 'aria-current="true"' : ''}>${emoji ? emoji + ' ' : ''}${esc(name)}</a>`).join('');

  const strandTotals = Object.entries(course.strands).map(([k, s]) => {
    const mine = modules.filter(m => m.strand === k);
    if (!mine.length) return '';
    const done = mine.filter(m => st[m.id].state === 'passed').length;
    return `<a class="strand-tile strand-${k}" href="${base()}?strand=${k}"><span aria-hidden="true">${s.emoji}</span><span>${esc(s.name)}</span><strong>${done} / ${mine.length}</strong></a>`;
  }).join('');

  shell(`<div class="home">
    <section class="card hero">
      <a class="small back-link" href="#/">← Dashboard</a>
      <span class="eyebrow">${esc(entry.title)} · ${fresh ? 'Welcome' : 'Pick up where you left off'}</span>
      ${nextStrand ? `<span class="pill strand-pill-${next.strand}">${nextStrand.emoji} ${esc(nextStrand.name)} · ${unitOf(course)} ${next.num}</span>` : ''}
      <h1>${esc(next.title)}</h1>
      <p class="muted">${esc(next.summary)}</p>
      ${ns.best != null ? `<p>Best score <strong>${ns.best}%</strong>. Score ${Math.round(course.passMark * 100)}%${next.kind === 'module' && next.num > 1 ? ' across the recall check and the quiz' : ''} to unlock the next one.</p>` : ''}
      <a class="btn wide" href="${hrefItem(next)}">${ns.best != null ? 'Carry on' : next.kind === 'intro' ? 'Start the course' : 'Start'}</a>
    </section>
    <section class="overall">
      <div class="row-between"><h2>Your course</h2><span class="muted">${passedCount} of ${modules.length} passed</span></div>
      <div class="bar"><span style="width:${(passedCount / modules.length) * 100}%"></span></div>
      <div class="strand-tiles">${strandTotals}</div>
    </section>
    <aside class="card side-lb" aria-labelledby="lb-h">
      <div class="row-between"><h2 id="lb-h">Leaderboard</h2><a class="small" href="#/leaderboard">See all</a></div>
      <div class="lb-mini"><p class="muted small">Loading…</p></div>
    </aside>
    <nav class="chips" aria-label="Filter by strand">${chips}</nav>
    <section class="items">${list}</section></div>`, { wide: true, title: entry.title });
  fillMiniLeaderboard(app.querySelector('.lb-mini'));
}

// ---------- dashboard ----------
// Every live course, loaded, with its progress keys and status.
async function liveCourses() {
  const list = await Promise.all(registry.courses.filter(e => e.live).map(e => loadCourseById(e.id)));
  return list.map(raw => {
    const c = { ...raw, course: withPlan(raw.course) };
    const key = id => itemKey(c.course, id);
    return { ...c, key, st: courseStatus(c.course.items, progress, c.course.ready, { unit: unitOf(c.course), unlockAll: sync.isAdmin(), key, plan: sync.planFor(c.course.id) }) };
  });
}

// Questions still being learnt (missed before), from every course: Map qid → { q, course, module }.
// Only the quizzes holding them are loaded. Question ids are unique across courses (tests/run.js).
async function questionBank(courses) {
  const need = srsModules(progress.state, registry.default);
  const bank = new Map();
  await Promise.all(courses.map(async c => {
    const nums = need[c.course.id];
    if (!nums) return;
    const items = c.course.items.filter(i => i.kind === 'module' && nums.has(i.num) && c.course.ready.includes(i.id));
    const quizzes = await Promise.all(items.map(i => c.files.quiz(i.id)));
    items.forEach((item, k) => {
      for (const q of quizzes[k]?.questions || []) bank.set(q.id, { q, course: c.course.id, module: item.num });
    });
  }));
  return bank;
}

const itemHref = (c, it) => `#/c/${c.course.id}/${it.kind === 'checkpoint' ? `cp/${it.num}` : `m/${it.id}`}`;
const itemName = it => (it.kind === 'checkpoint' ? it.title : it.kind === 'intro' ? 'Introduction' : it.kind === 'guide' ? it.short : `${UnitOf(course)} ${it.num}: ${it.short || it.title}`);

async function viewDashboard() {
  const courses = await liveCourses();
  const bank = await questionBank(courses);
  const today = progress.today();
  const refresh = pickRefresh(progress.state, bank, today);
  const active = lastActive(progress.state, registry.default);
  const byId = Object.fromEntries(courses.map(c => [c.course.id, c]));
  const recent = courses.filter(c => active[c.course.id]).sort((a, b) => active[b.course.id] - active[a.course.id]);
  const here = recent[0] || byId[registry.default];
  const started = Boolean(active[here.course.id]);
  const next = nextItem(here.course, here.st, started);
  const nick = sync.signedIn() && sync.hasNickname() ? progress.state.nickname : null;

  // Continue where you left off
  let hero;
  if (next) {
    const ns = here.st[next.id];
    hero = `<section class="card hero continue">
      <span class="eyebrow">${started ? 'Continue where you left off' : 'Start here'} · ${esc(here.entry.title)}</span>
      <h2 class="hero-title">${esc(next.title)}</h2>
      <p class="muted">${esc(next.summary || '')}</p>
      ${ns.best != null ? `<p>Best score <strong>${ns.best}%</strong>. Score ${Math.round(here.course.passMark * 100)}% to unlock the next one.</p>` : ''}
      <a class="btn wide" href="${itemHref(here, next)}">${ns.best != null ? 'Carry on' : next.kind === 'intro' ? 'Start the course' : 'Start'}</a>
    </section>`;
  } else {
    hero = `<section class="card hero continue"><span class="eyebrow">${esc(here.entry.title)}</span><h2 class="hero-title">Course finished</h2>
      <p>You've passed every ${unitOf(here.course)}. Retake any quiz or refresh what you got wrong to keep it fresh.</p><a class="btn wide" href="#/c/${here.course.id}">Open the course</a></section>`;
  }

  // Refresh knowledge
  const refreshCard = refresh.waiting ? `<section class="card refresh-card">
      <div class="row-between"><h2>Refresh knowledge</h2><span class="tag ${refresh.due ? 'warm' : 'good'}">${refresh.due ? `${refresh.due} due` : 'Nothing due today'}</span></div>
      <p class="muted">A quick set of ${refresh.questions.length} questions you got wrong before${courses.length > 1 ? ', from every course' : ''}. Each one comes back further apart until it sticks.</p>
      <a class="btn${refresh.due ? '' : ' ghost'} wide" href="#/refresh">Start a refresh set</a>
    </section>` : '';

  // Course picker
  const cards = registry.courses.map(e => {
    const c = byId[e.id];
    const board = e.board ? `${e.board.toUpperCase()}${e.spec ? ` · ${esc(e.spec)}` : ''}` : 'Any age · UK';
    if (!c) {
      return `<div class="course-card soon"><span class="eyebrow">${board}</span><strong class="cc-title">${esc(e.title)}</strong>
        <span class="muted small">${esc(registry.subjects[e.subject]?.blurb || '')}</span><span class="tag">Coming soon</span>${e.preview && sync.isAdmin() ? `<a class="small" href="#/c/${esc(e.id)}">Preview the draft</a>` : ''}</div>`;
    }
    const p = coursePercent(c.course, c.st);
    const locked = e.needsAccount && !sync.hasNickname() && !sync.isAdmin();
    return `<a class="course-card" href="#/c/${e.id}"><span class="eyebrow">${board}</span><strong class="cc-title">${esc(e.title)}</strong>
      <span class="muted small">${esc(registry.subjects[e.subject]?.blurb || '')}</span>
      <span class="bar" role="progressbar" aria-label="${esc(e.title)} complete" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.pct}"><span style="width:${p.pct}%"></span></span>
      <span class="small"><strong>${p.pct}%</strong> · ${p.passed} of ${p.total} ${unitOf(c.course)}s passed${locked ? ' · needs a free account' : ''}</span></a>`;
  }).join('');

  shell(`<div class="home dash">
    <h1 class="dash-title">${nick ? `Hi ${esc(nick)}` : 'Your dashboard'}</h1>
    ${hero}
    ${refreshCard}
    <section class="courses"><h2>Your courses</h2><div class="course-grid">${cards}</div></section>
    <section class="card exams" id="exams">${examsHtml(courses, here, refresh)}</section>
    <section class="card classes-card"><div class="row-between"><h2>Classes</h2><a class="small" href="#/teach">For teachers</a></div>
      <p class="muted small">In a class at school? Join with your teacher's code.</p><a class="btn ghost" href="#/classes">Your classes</a></section>
    <aside class="card side-lb" aria-labelledby="lb-h">
      <div class="row-between"><h2 id="lb-h">Leaderboard</h2><a class="small" href="#/leaderboard">See all</a></div>
      <div class="lb-mini"><p class="muted small">Loading…</p></div>
    </aside></div>`, { wide: true });
  wireExams(app.querySelector('#exams'));
  fillMiniLeaderboard(app.querySelector('.lb-mini'));
}

// Exam countdown: official dates from the course registry (with their source) and the learner's own,
// then a plan for this week before the soonest one.
function examsHtml(courses, here, refresh) {
  const today = progress.today();
  const byId = Object.fromEntries(courses.map(c => [c.course.id, c]));
  const official = courses.flatMap(c => (c.entry.exams || []).map((x, k) => ({ id: `o-${c.course.id}-${k}`, name: x.paper, date: x.date, course: c.course.id, official: x })));
  const mine = exams.get().list;
  const soon = upcoming([...official, ...mine], today);
  const past = mine.filter(e => e.date < today);
  const courseName = id => (byId[id] ? byId[id].entry.title : '');
  const row = e => `<li class="exam${e.days <= 14 ? ' close' : ''}"><span class="days"><strong>${e.days}</strong> ${e.days === 1 ? 'day' : 'days'}</span>
    <span class="ex-txt"><span class="ex-name">${esc(e.name)}</span><span class="muted small">${esc(niceDate(e.date))}${e.course ? ` · ${esc(courseName(e.course))}` : ''}${e.official ? ` · <a href="${esc(e.official.url)}">${esc(e.official.source)}</a>, checked ${esc(niceDate(e.official.checked))}` : ''}</span></span>
    ${e.official ? '' : `<button type="button" class="icon-btn remove" data-id="${esc(e.id)}" aria-label="Remove ${esc(e.name)}">×</button>`}</li>`;

  let plan = '';
  const first = soon[0];
  if (first) {
    const c = (first.course && byId[first.course]) || here;
    const weak = weakSpots(progress.state, c.course, c.key, c.st);
    const started = Boolean(lastActive(progress.state, registry.default)[c.course.id]);
    const p = weekPlan({ days: first.days, refresh: refresh.due, weak, next: nextItem(c.course, c.st, started) });
    const step = s => s.kind === 'refresh' ? `<li><a href="#/refresh">Refresh knowledge</a>: ${s.count} ${s.count === 1 ? 'question' : 'questions'} due.</li>`
      : s.kind === 'retake' ? `<li>Retake <a href="${itemHref(c, s.item)}">${esc(itemName(s.item))}</a> (best ${s.best}%).</li>`
      : s.kind === 'topics' ? `<li>Go back over ${s.topics.map(t => `<a href="${itemHref(c, t.item)}">${esc(t.topic)}</a>`).join(', ')}.</li>`
      : `<li>Learn next: <a href="${itemHref(c, s.item)}">${esc(itemName(s.item))}</a>.</li>`;
    plan = `<div class="plan"><h3>This week, for ${esc(first.name)}</h3>
      <p class="muted small">${p.weeks} ${p.weeks === 1 ? 'week' : 'weeks'} to go · ${esc(c.entry.title)}. ${esc(p.pace)}</p>
      ${p.steps.length ? `<ol>${p.steps.map(step).join('')}</ol>` : '<p>Nothing weak yet. Keep going with the course.</p>'}
      ${weak.topics.length ? '' : '<p class="muted small">Your weakest topics show here once you\'ve done a few quizzes.</p>'}</div>`;
  }
  const opts = courses.map(c => `<option value="${esc(c.course.id)}">${esc(c.entry.title)}</option>`).join('');
  return `<h2>Exam countdown</h2>
    ${soon.length ? `<ul class="exam-list">${soon.map(row).join('')}</ul>` : '<p class="muted">Add your exam dates, mocks too, for a countdown and a plan for each week.</p>'}
    ${plan}
    ${past.length ? `<p class="muted small past-exams">Done: ${past.map(e => `${esc(e.name)} (${esc(niceDate(e.date))}) <button type="button" class="linkish remove" data-id="${esc(e.id)}" aria-label="Remove ${esc(e.name)}">remove</button>`).join(' · ')}</p>` : ''}
    <details class="add-exam"${soon.length ? '' : ' open'}><summary>Add an exam date</summary>
      <form class="exam-form" novalidate>
        <label>Exam<input name="name" maxlength="${exams.MAX_NAME}" placeholder="e.g. Economics mock, Paper 1" autocomplete="off"></label>
        <label>Date<input name="date" type="date" min="${today}"></label>
        ${courses.length > 1 ? `<label>Course<select name="course"><option value="">Any</option>${opts}</select></label>` : `<input type="hidden" name="course" value="${esc(courses[0].course.id)}">`}
        <button type="submit" class="btn">Add</button>
        <p class="auth-error exam-msg" role="alert" hidden></p>
      </form></details>
    <p class="muted small">${sync.signedIn() ? 'Saved to your account.' : 'Saved in this browser; make an account to keep them on any device.'}</p>`;
}

function wireExams(box) {
  const form = box.querySelector('.exam-form');
  const msg = box.querySelector('.exam-msg');
  const say = t => { msg.textContent = t; msg.hidden = !t; };
  form.addEventListener('submit', e => {
    e.preventDefault();
    const f = form.elements;
    const name = f.name.value.replace(/\s+/g, ' ').trim();
    const date = f.date.value;
    const list = exams.get().list;
    if (!name) return say('Give the exam a name.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return say('Pick the date of the exam.');
    if (date < progress.today()) return say('That date has passed. Pick a date from today on.');
    if (list.length >= exams.MAX_EXAMS) return say(`You can keep up to ${exams.MAX_EXAMS} exams. Remove one first.`);
    exams.set([...list, { id: exams.newId(), name, date, ...(f.course.value ? { course: f.course.value } : {}) }]);
    toast(`Added ${name}`);
    route();
  });
  box.addEventListener('click', e => {
    const b = e.target.closest('.remove');
    if (!b) return;
    exams.set(exams.get().list.filter(x => x.id !== b.dataset.id));
    route();
  });
}

// Refresh knowledge: a quick set of questions got wrong before, from every course.
async function viewRefresh() {
  const courses = await liveCourses();
  const bank = await questionBank(courses);
  shell(`<article class="lesson"><header class="lesson-head"><span class="pill">🔁 Refresh knowledge</span><h1>Refresh knowledge</h1>
    <p class="muted">Questions you got wrong before${courses.length > 1 ? ', from every course' : ''}. Get one right and it comes back later, further apart each time, until it sticks. ${XP_RULES.perRecall} XP per right answer in your first set each day.</p></header>
    <div class="quiz"></div></article>`, { title: 'Refresh knowledge' });
  const box = app.querySelector('.quiz');
  const empty = `<div class="card"><p><strong>Nothing to refresh.</strong> Questions you get wrong in quizzes and recall checks come back here.</p><a class="btn" href="#/">Back to the dashboard</a></div>`;
  const start = () => {
    const pick = pickRefresh(progress.state, bank, progress.today());
    if (!pick.questions.length) { box.innerHTML = empty; return; }
    const qs = pick.questions.map(b => ({ ...instantiate(b.q, { randomise: true }), module: b.module }));
    const xpBefore = progress.xp().total;
    runQuiz(box, qs, {
      kind: 'recall', title: 'Refresh knowledge', passMark: 0, onRetry: start,
      onFinish: s => {
        progress.recordAttempt({ kind: 'recall', id: REFRESH_ID, auto: s.auto, claimed: s.claimed, outOf: s.outOf, results: s.results });
        refreshStrip(); sync.pushSoon();
        const gained = progress.xp().total - xpBefore;
        return `<p class="muted">${gained > 0 ? `+${gained} XP` : 'No new XP: refresh XP counts your first set each day.'}</p>${saveBanner()}<a class="btn ghost" href="#/">Back to the dashboard</a>`;
      },
    });
  };
  const pick = pickRefresh(progress.state, bank, progress.today());
  if (!pick.questions.length) { box.innerHTML = empty; return; }
  box.innerHTML = `<div class="card"><p>${pick.due ? `<strong>${pick.due} due today.</strong> ` : ''}${pick.questions.length} quick ${pick.questions.length === 1 ? 'question' : 'questions'}, about two minutes.</p><button type="button" class="btn wide">Start</button></div>`;
  box.querySelector('button').addEventListener('click', start);
}

async function fillMiniLeaderboard(box) {
  const rows = await sync.leaderboard();
  if (!box.isConnected) return;
  if (!rows) {
    box.innerHTML = `<p class="small muted">${sync.enabled() ? 'Make a free account to join.' : 'Coming soon.'}</p>`;
    return;
  }
  const me = rows.find(r => r.is_me);
  const top = rows.slice(0, 5);
  const row = r => `<li class="${r.is_me ? 'me' : ''}"><strong class="pos">${r.pos}</strong><span class="nick">${esc(r.nickname)}${r.is_me ? ' (you)' : ''}</span><span class="muted small">Lv ${r.level}</span><strong>${r.xp}</strong></li>`;
  box.innerHTML = (top.length ? `<ol class="lb-list mini">${top.map(row).join('')}${me && !top.includes(me) ? `<li class="gap" aria-hidden="true">···</li>${row(me)}` : ''}</ol>` : '<p class="small muted">Nobody here yet. Be first.</p>')
    + (me ? '' : `<a class="btn ghost wide join" href="#/account">${sync.signedIn() ? 'Pick a nickname to join' : 'Join the leaderboard'}</a>`);
}

async function viewModule(id) {
  const item = itemById(id);
  if (!item || item.kind === 'checkpoint') return viewNotFound();
  const st = statusMap()[id];
  if (st.state === 'locked' || (st.state === 'soon' && !sync.isAdmin())) return viewLocked(item, st);
  const strand = strandOf(item);
  const [md, quiz] = await Promise.all([files.lesson(id), item.kind === 'module' ? files.quiz(id) : null]);
  const { sections, blocks } = parseLesson(md, { figures, glossary });
  const minutes = Math.max(5, Math.round(md.split(/\s+/).length / 200) + (quiz ? 10 : 0) + blocks.length);

  const sectionHtml = sections.map((s, k) => `<section class="lesson-section" id="s${k}">${s.title ? `<h2>${esc(s.title)}</h2>` : ''}${s.html}</section>`).join('');
  const isTrading = item.strand === 'trading';
  shell(`
    <article class="lesson">
      <header class="lesson-head">
        ${strand ? `<span class="pill strand-pill-${item.strand}">${strand.emoji} ${esc(strand.name)}${item.kind === 'guide' ? '' : ` · ${esc(item.level)}`}</span>` : '<span class="pill">Start here</span>'}
        <h1>${esc(item.title)}</h1>
        ${canSpeak() ? '<div class="read-aloud" data-no-speak><button type="button" class="btn ghost listen" aria-label="Listen to this lesson">🔊 Listen</button><button type="button" class="btn ghost pause-read" hidden>Pause</button><button type="button" class="btn ghost stop-read" hidden>Stop</button></div>' : ''}
        <p class="muted">About ${minutes} minutes${item.buildsOn.length ? ` · builds on ${item.buildsOn.map(n => n === 0 ? 'the introduction' : `${unitOf(course)} ${n}`).join(', ')}` : ''}</p>
        ${isTrading ? `<aside class="callout callout-paper"><span class="eyebrow">Paper trading only</span><p>Education only, not financial advice. Practise with pretend money; most people who trade with real money lose it.</p></aside>` : ''}
      </header>
      ${item.num > 1 ? '<section class="recall" id="recall"></section>' : ''}
      ${sectionHtml}
      <section class="card own-words" id="own-words">
        <h2>In my own words</h2>
        <p class="muted">Explain it as if to a friend. Note anything that confused you. ${sync.signedIn() ? 'Saved to your account.' : 'Saved in this browser; make an account to keep it.'}</p>
        <textarea rows="6" aria-label="In my own words">${esc(progress.state.notes[K(id)]?.text || '')}</textarea>
        <span class="saved-note" aria-live="polite"></span>
      </section>
      ${quiz ? `<section class="quiz-wrap" id="quiz"><h2>${UnitOf(course)} quiz</h2><p class="muted quiz-rule">${quiz.pick} questions. Score ${Math.round(course.passMark * 100)}% to pass${nextItemLabel(item)}. Retry as often as you like; your best attempt counts.</p><div class="quiz"></div></section>` : ''}
      ${nav(item)}
    </article>`, { title: item.short || item.title });

  const article = app.querySelector('.lesson');
  hydrateBlocks(article, blocks, { progress, moduleId: K(id), figures, glossary });
  wireTerms(article);
  wireOwnWords(article, K(id));
  wireReading(article, K(id));
  wireListen(article);
  if (item.kind === 'module') await mountModuleTest(article, item, quiz);
}

// Read aloud: the title, then each paragraph, heading, list and callout of the lesson, one at a time.
function wireListen(article) {
  const bar = article.querySelector('.read-aloud');
  if (!bar) return;
  const [listen, pauseBtn, stopBtn] = bar.querySelectorAll('button');
  const show = state => {
    listen.hidden = state !== 'stopped';
    pauseBtn.hidden = stopBtn.hidden = state === 'stopped';
    pauseBtn.textContent = state === 'paused' ? 'Resume' : 'Pause';
  };
  listen.addEventListener('click', () => {
    const blocks = [article.querySelector('h1'), ...article.querySelectorAll('.lesson-section > :is(h2, h3, p, ul, ol, aside, blockquote, table, details)')];
    speak(blocks.map(b => ({ el: b, text: textOf(b) })), { onState: show });
  });
  pauseBtn.addEventListener('click', () => {
    if (pauseBtn.textContent === 'Pause') { pause(); show('paused'); } else { resume(); show('playing'); }
  });
  stopBtn.addEventListener('click', () => stopSpeaking());
  cleanup.push(() => stopSpeaking());
}

function nextItemLabel(item) {
  const idx = course.items.indexOf(item);
  const next = course.items[idx + 1];
  if (!next || item.kind === 'intro') return '';
  return next.kind === 'checkpoint' ? ` and unlock ${next.title.toLowerCase()}` : ` and unlock ${unitOf(course)} ${next.num}`;
}

function nav(item) {
  const idx = course.items.indexOf(item);
  const prev = course.items[idx - 1], next = course.items[idx + 1];
  const link = (it, dir) => it ? `<a class="nav-${dir}" href="${hrefItem(it)}"><span class="muted">${dir === 'prev' ? '← Previous' : 'Next →'}</span><span>${esc(it.short || it.title)}</span></a>` : '<span></span>';
  return `<nav class="prev-next">${link(prev, 'prev')}${link(next, 'next')}</nav>`;
}

function wireOwnWords(root, id) {
  const ta = root.querySelector('.own-words textarea');
  const note = root.querySelector('.own-words .saved-note');
  let t;
  ta.addEventListener('input', () => {
    clearTimeout(t);
    note.textContent = '';
    t = setTimeout(() => { progress.saveNote(id, ta.value); note.textContent = 'Saved'; sync.pushSoon(); }, 700);
  });
}

function wireReading(root, id) {
  const bar = document.querySelector('.read-progress');
  bar.hidden = false;
  const fill = bar.querySelector('span');
  const onScroll = () => {
    const end = root.querySelector('#own-words');
    const total = end.offsetTop - window.innerHeight * 0.6;
    const p = Math.min(1, Math.max(0, window.scrollY / Math.max(1, total)));
    fill.style.width = `${p * 100}%`;
    if (p >= 1 && progress.markRead(id)) { refreshStrip(); sync.pushSoon(); toast(`${UnitOf(course)} read: +20 XP`); }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  cleanup.push(() => window.removeEventListener('scroll', onScroll));
  onScroll();
}

// The recall check (questions from earlier modules) and the module quiz are marked together: the pass
// is worked out from both parts' marks. Each quiz attempt needs a fresh recall check first.
// Module 1 has nothing earlier to recall, so its pass is from the quiz alone.
async function mountModuleTest(article, item, quiz) {
  const key = K(item.id);
  const top = article.querySelector('#recall');
  const box = article.querySelector('#quiz .quiz');
  // In a class with its own order, "earlier" means lessons this student has passed, not lower numbers.
  const plan = sync.planFor(course.id);
  const before = plan ? Infinity : item.num;
  const done = plan && new Set(course.items.filter(i => i.kind === 'module' && i.id !== item.id && progress.passed(K(i.id))).map(i => i.num));
  const pools = plan ? await files.pools(course, Infinity, done) : item.num > 1 ? await files.pools(course, item.num - 1) : {};
  const recallSize = pickRecall(progress, pools, before, 4).length;
  const hasRecall = recallSize > 0;
  if (!hasRecall) top?.remove();
  if (!box) return;
  if (hasRecall) {
    article.querySelector('.quiz-rule').textContent = `A ${recallSize}-question recall check from earlier ${unitOf(course)}s, then ${quiz.pick} quiz questions. Score ${Math.round(course.passMark * 100)}% across both parts to pass${nextItemLabel(item)}. Retry as often as you like; your best attempt counts.`;
  }

  const recallPart = () => {
    const r = hasRecall && progress.pendingRecall(key);
    return r ? { title: 'Recall check', auto: r.auto, claimed: r.claimed || 0, outOf: r.outOf } : null;
  };

  // Runs a fresh recall check in container. nextHtml shows under its result; then(container) wires it.
  function runRecall(container, nextHtml, then) {
    const qs = pickRecall(progress, pools, before, 4).map(q => ({ ...instantiate(q, { randomise: true }), module: q.module }));
    runQuiz(container, qs, {
      kind: 'recall', title: 'Recall check', passMark: 0,
      onFinish: s => {
        progress.recordAttempt({ kind: 'recall', id: key, auto: s.auto, claimed: s.claimed, outOf: s.outOf, results: s.results });
        refreshStrip(); sync.pushSoon();
        return nextHtml;
      },
      afterRender: c => { if (then) then(c); if (c !== top) renderTop(); renderQuizIntro(); },
    });
  }

  // "Before you read": the recall check at the top of the lesson.
  function renderTop() {
    if (!top || !top.isConnected || top.querySelector('.question')) return; // mid-check: leave it
    const done = recallPart();
    top.innerHTML = done
      ? `<div class="card recall-done"><span aria-hidden="true">✓</span><p><strong>Recall check done: ${done.auto + done.claimed} of ${done.outOf}.</strong> It counts towards this ${unitOf(course)}'s pass, with the quiz.</p></div>`
      : `<div class="recall-intro card"><span class="eyebrow">Before you read · Recall check · ${recallSize} quick questions</span><p>Questions from earlier ${unitOf(course)}s, starting with ones you've missed before. Recalling beats rereading. Your marks count towards this ${unitOf(course)}'s pass, with the quiz.</p><button type="button" class="btn start-recall">Start recall check</button><button type="button" class="btn ghost skip">Later</button></div>`;
    top.querySelector('.skip')?.addEventListener('click', () => { top.innerHTML = `<p class="small muted">You'll do the recall check just before the quiz.</p>`; });
    top.querySelector('.start-recall')?.addEventListener('click', () => runRecall(top, '<p class="muted">Now on to the lesson. These marks count with your quiz.</p>'));
  }

  function startQuiz() {
    const carry = recallPart();
    if (hasRecall && !carry) return begin();
    const tries = progress.attemptsFor(key).length;
    const qs = buildAttempt(quiz.questions, quiz.pick, { randomise: tries > 0 }).map(q => ({ ...q, module: item.num }));
    const xpBefore = progress.xp().total;
    const wasPassed = progress.passed(key);
    runQuiz(box, qs, {
      kind: 'quiz', title: `Module ${item.num} quiz`, passMark: course.passMark, carry,
      onRetry: begin,
      onFinish: s => {
        progress.recordAttempt({
          kind: 'quiz', id: key, auto: s.part.auto, claimed: s.part.claimed, outOf: s.part.outOf,
          passed: s.passed, autoPassed: s.autoPassed, recall: carry, results: s.results,
        });
        sync.pushSoon();
        const gained = progress.xp().total - xpBefore;
        refreshStrip();
        const next = course.items[course.items.indexOf(item) + 1];
        let html = `<p class="muted">${gained > 0 ? `+${gained} XP` : 'No new XP: XP counts your best auto-marked score once.'}</p>${saveBanner()}`;
        if (s.passed && !wasPassed && next) {
          html += `<a class="btn wide" href="${hrefItem(next)}">Unlocked: ${esc(next.short || next.title)} →</a>`;
        } else if (!s.passed && next) {
          html += `<p>${esc(next.kind === 'checkpoint' ? next.title : `${UnitOf(course)} ${next.num}`)} stays locked until you pass. Retries use ${hasRecall ? 'a new recall check, ' : ''}new questions and new numbers.</p>`;
        }
        return html;
      },
      afterRender: renderTop,
    });
  }

  // Start (or retry): a fresh recall check first if this module has one, then the quiz.
  function begin() {
    if (hasRecall && !recallPart()) {
      runRecall(box, '<button type="button" class="btn wide go-quiz">Part 2: the quiz →</button>',
        c => c.querySelector('.go-quiz').addEventListener('click', startQuiz));
    } else startQuiz();
  }

  function renderQuizIntro() {
    if (box.querySelector('.question, .result')) return; // mid-quiz or showing a result: leave it
    const best = progress.best(key);
    const done = recallPart();
    const steps = !hasRecall ? 'Each question shows the right answer and why straight after you answer.'
      : done ? `Recall check done (${done.auto + done.claimed} of ${done.outOf}); it counts with the quiz.`
      : `Part 1 is a quick recall check from earlier ${unitOf(course)}s, part 2 is the quiz. Both count towards your pass.`;
    box.innerHTML = `<div class="card"><p>${best ? `Your best: <strong>${Math.round(attemptPct(best) * 100)}%</strong>. ` : ''}${steps}</p><button type="button" class="btn wide">${hasRecall && !done ? 'Start the recall check' : best ? 'Retake the quiz' : 'Start the quiz'}</button></div>`;
    box.querySelector('button').addEventListener('click', begin);
  }

  renderTop();
  renderQuizIntro();
}

async function viewCheckpoint(num) {
  const item = course.items.find(i => i.kind === 'checkpoint' && i.num === +num);
  if (!item) return viewNotFound();
  const st = statusMap()[item.id];
  if (st.state === 'locked' || (st.state === 'soon' && !sync.isAdmin())) return viewLocked(item, st);
  const key = K(item.id);
  shell(`<article class="lesson"><header class="lesson-head"><span class="pill">✏️ Checkpoint ${item.num}</span><h1>${esc(item.title)}</h1>
    <p class="muted">${esc(item.summary)} About 20 minutes. Pass mark ${Math.round(course.passMark * 100)}%.</p></header><div class="quiz"></div>${nav(item)}</article>`, { title: item.title });
  const box = app.querySelector('.quiz');
  const pools = await files.pools(course, item.covers[1]);
  const start = () => {
    const xpBefore = progress.xp().total;
    const wasPassed = progress.passed(key);
    const qs = buildCheckpoint(pools, item.covers, { size: item.size || (item.num === 4 ? 20 : 18), recentSpan: item.even ? Infinity : 8 });
    runQuiz(box, qs, {
      kind: 'checkpoint', title: item.title, passMark: course.passMark, onRetry: start,
      onFinish: s => {
        progress.recordAttempt({ kind: 'checkpoint', id: key, ...s });
        sync.pushSoon(); refreshStrip();
        const gained = progress.xp().total - xpBefore;
        const next = course.items[course.items.indexOf(item) + 1];
        let html = `<p class="muted">${gained > 0 ? `+${gained} XP` : 'No new XP: XP counts your best auto-marked score once.'}</p>${saveBanner()}`;
        if (s.passed && !wasPassed) {
          html += next ? `<a class="btn wide" href="${hrefItem(next)}">Unlocked: ${esc(next.short || next.title)} →</a>`
            : `<p><strong>That's the whole course done.</strong> Retake any quiz to keep it fresh.</p>`;
        } else if (!s.passed && next) {
          html += `<p>${UnitOf(course)} ${next.num} stays locked until you pass. Retries use new questions and new numbers.</p>`;
        }
        return html;
      },
    });
  };
  box.innerHTML = `<div class="card"><p>${item.even ? `Questions from across ${unitOf(course)}s ${item.covers[0]} to ${item.covers[1]}.` : `Questions from every ${unitOf(course)} so far, mostly the latest eight.`}</p><button type="button" class="btn wide">Start the checkpoint</button></div>`;
  box.querySelector('button').addEventListener('click', start);
}

function viewLocked(item, st) {
  shell(`<section class="card locked-view">${lockIcon()}<h1>${esc(item.title)}</h1><p>${esc(st.reason)}.</p>
    <p class="muted">${esc(item.summary || '')}</p><a class="btn" href="${base()}">Back to the course</a></section>`, { title: item.title });
}

function viewNotFound() {
  shell(`<section class="card"><h1>Page not found</h1><a class="btn" href="#/">Back to the course</a></section>`);
}

function viewGlossary(params) {
  const terms = Object.entries(glossary).sort((a, b) => a[1].term.localeCompare(b[1].term));
  const focus = params.get('t');
  shell(`<h1>Glossary</h1><label class="search"><span class="sr">Search terms</span><input type="search" placeholder="Search ${terms.length} terms" value="${esc(focus ? glossary[focus]?.term || '' : '')}"></label>
    <dl class="glossary">${terms.map(([k, g]) => {
      const m = itemById(g.module);
      return `<div class="g-item" id="t-${esc(k.replace(/\W+/g, '-'))}" data-k="${esc((g.term + ' ' + g.def).toLowerCase())}"><dt>${esc(g.term)}</dt><dd>${esc(g.def)}<a class="small" href="${hrefItem(m)}">${m.kind === 'intro' ? 'Introduction' : `Module ${m.num}: ${esc(m.short)}`}</a></dd></div>`;
    }).join('')}</dl>`, { title: 'Glossary' });
  const input = app.querySelector('.search input');
  const filterList = () => {
    const q = input.value.trim().toLowerCase();
    for (const d of app.querySelectorAll('.g-item')) d.hidden = q && !d.dataset.k.includes(q);
  };
  input.addEventListener('input', filterList);
  filterList();
}

async function viewLeaderboard() {
  const xp = progress.xp().total;
  const lv = levelFor(xp);
  shell(`<h1>Leaderboard</h1><p class="muted">Shows nickname, level and XP only. Claimed marks never count.</p><div class="lb">Loading…</div>`, { title: 'Leaderboard' });
  const box = app.querySelector('.lb');
  const rows = await sync.leaderboard();
  const joined = rows && rows.some(r => r.is_me);
  const invite = joined ? '' : `<div class="card"><p>You're on <strong>level ${lv.level}</strong> with <strong>${xp} XP</strong>.</p>
    <p>${!sync.enabled() ? 'The leaderboard switches on once accounts are set up.' : sync.signedIn() ? 'Pick a nickname to join the leaderboard.' : 'Make a free account and pick a nickname to join the leaderboard.'}</p>
    ${sync.enabled() ? `<a class="btn" href="#/account">${sync.signedIn() ? 'Pick a nickname' : 'Make an account'}</a>` : ''}</div>`;
  if (!rows || !rows.length) { box.innerHTML = invite || '<p class="muted">Nobody here yet.</p>'; return; }
  box.innerHTML = invite + `<ol class="lb-list">${rows.map(r => `<li class="${r.is_me ? 'me' : ''}"><strong class="pos">${r.pos}</strong><span class="nick">${esc(r.nickname)}${r.is_me ? ' (you)' : ''}</span><span class="muted">Lv ${r.level}</span><strong>${r.xp}</strong></li>`).join('')}</ol>`;
}

// Which course and item a progress key belongs to (see itemKey).
async function itemForKey(key) {
  const i = key.indexOf(':');
  const c = await loadCourseById(i < 0 ? registry.default : key.slice(0, i));
  const item = c && c.course.items.find(it => it.id === (i < 0 ? key : key.slice(i + 1)));
  return item ? { c, item } : null;
}

async function viewAccount() {
  const notes = [];
  for (const [key, n] of Object.entries(progress.state.notes)) {
    const found = n.text.trim() && await itemForKey(key);
    if (found) notes.push({ ...found, n });
  }
  const many = new Set(notes.map(x => x.c.course.id)).size > 1;
  shell(`<h1>Your account</h1>
    <section class="card" id="auth-box">${await sync.authPanel()}</section>
    <section class="card"><h2>My notes</h2>${notes.length ? notes.map(({ c, item: m, n }) => {
      const label = `${many ? `${c.entry.title} · ` : ''}${m.kind === 'intro' ? 'Introduction' : m.kind === 'guide' ? m.short : `${UnitOf(c.course)} ${m.num}: ${m.short || m.title}`}`;
      return `<div class="note"><a href="#/c/${c.course.id}/m/${m.id}">${esc(label)}</a><p>${esc(n.text)}</p><span class="small muted">${esc(niceDate(n.at))}</span></div>`;
    }).join('') : '<p class="muted">Your "In my own words" notes will show here.</p>'}</section>
    <section class="card"><h2>Your data</h2>
      <p>Download everything this course holds about you, as a JSON file.</p>
      <button type="button" class="btn ghost export">Export my data</button>
      <h3>Delete</h3>
      <p>${sync.signedIn() ? 'Deletes your account and every row of your data, for good.' : 'Clears your progress from this browser.'}</p>
      <button type="button" class="btn danger delete">${sync.signedIn() ? 'Delete my account' : 'Clear my progress'}</button>
    </section>
    ${displaySettings()}`, { title: 'Account' });
  sync.wireAuthPanel(app.querySelector('#auth-box'), () => route(), name => {
    location.hash = '#/';
    toast(`Saved. You're on the leaderboard as ${name}`);
  });
  app.querySelector('.settings-grid').addEventListener('change', e => display.set({ [e.target.name]: e.target.value }));
  app.querySelector('.export').addEventListener('click', async () => {
    const data = await sync.exportAll(progress.state);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = el(`<a download="compound-my-data.json" href="${URL.createObjectURL(blob)}"></a>`);
    document.body.append(a); a.click(); a.remove();
  });
  app.querySelector('.delete').addEventListener('click', async () => {
    const msg = sync.signedIn()
      ? 'Delete your account and all your progress, notes and quiz history? This cannot be undone.'
      : 'Clear all your progress, notes and quiz history from this browser? This cannot be undone.';
    if (!confirm(msg)) return;
    if (sync.signedIn()) {
      try { await sync.deleteAccount(); } catch (e) { toast(`Couldn't delete: ${e.message}`); return; }
    }
    progress.replace({});
    toast('Deleted');
    location.hash = '#/';
  });
}

function displaySettings() {
  const d = display.get();
  const groups = Object.entries(display.OPTIONS).map(([k, o]) => `<fieldset><legend>${esc(o.label)}</legend><div class="seg">${Object.entries(o.choices).map(([v, label]) => `<label><input type="radio" name="${k}" value="${v}"${d[k] === v ? ' checked' : ''}><span>${esc(label)}</span></label>`).join('')}</div></fieldset>`).join('');
  return `<section class="card" id="display"><h2>Display and reading</h2>
    <p class="muted">Changes apply straight away. Saved in this browser${sync.signedIn() ? ' and to your account, so they follow you to any device' : ''}.${canSpeak() ? ' Lessons have a 🔊 Listen button that reads them aloud.' : ''}</p>
    <form class="settings-grid" onsubmit="return false">${groups}</form></section>`;
}

// A-level courses need an account with a nickname.
async function viewNeedsAccount() {
  const signedIn = sync.signedIn();
  shell(`<section class="card locked-view">${lockIcon()}<h1>${esc(entry.title)}</h1>
    <p>${signedIn ? 'Pick a nickname on your account page to start this course.' : 'This course needs a free account with a nickname.'}</p>
    <a class="btn" href="#/account">${signedIn ? 'Pick a nickname' : 'Make an account or sign in'}</a></section>`, { title: entry.title });
  if (!signedIn && sync.available()) showSignup({ required: true });
}

function viewAbout() {
  const R = XP_RULES;
  const figs = Object.values(figures.figures);
  shell(`<article class="prose">
    <h1>About Compound</h1>
    <p>Compound is a free course on money, investing, trading and the finance industry, for anyone in the UK. It assumes you know nothing and takes you to a solid intermediate level in 32 modules.</p>
    <p><strong>Made by Ivor Fergusson.</strong></p>
    <h2>Not financial advice</h2>
    <p>This course is education only. It explains how things work so you can make your own decisions; it doesn't know your situation and doesn't recommend any product. Trading is taught with pretend money only. For free, impartial help, try <a href="https://www.moneyhelper.org.uk/">MoneyHelper</a>, which is backed by the government.</p>
    <p>Rules are for the UK: England, Wales and Northern Ireland, with Scotland flagged where income tax differs.</p>
    <h2>How XP works</h2>
    <ul>
      <li><strong>${R.read} XP</strong> for reading a module to the end.</li>
      <li><strong>${R.perMark} XP per mark</strong> on each quiz and checkpoint, using your best auto-marked score. Retrying can only raise it, never double it.</li>
      <li><strong>Passing a module:</strong> every module from 2 on starts with a short recall check of questions from earlier modules, then the quiz. You need ${Math.round(course.passMark * 100)}% across both parts together, and each retry starts with a fresh recall check. Module 1 has no recall check, so its pass is from the quiz alone. Modules you passed before this rule came in stay passed.</li>
      <li><strong>${R.firstPassModule} XP</strong> the first time you pass a module, and <strong>${R.firstPassCheckpoint} XP</strong> for a checkpoint. This bonus needs ${Math.round(course.passMark * 100)}% from auto-marked answers alone (recall check and quiz together).</li>
      <li><strong>${R.perRecall} XP</strong> per right answer in a module's first recall check each day, and in your first refresh knowledge set each day (on the dashboard).</li>
      <li><strong>${R.perDay} XP</strong> for each day you do something, and <strong>${R.streakWeek} XP</strong> for every 7 days in a row.</li>
      <li><strong>Claimed marks</strong> ("I had this") help you pass and unlock the next module, but never earn XP. That keeps the leaderboard fair.</li>
      <li>Levels get further apart as you go: level 2 at 100 XP, level 3 at 300, level 4 at 600, level 5 at 1,000.</li>
    </ul>
    <h2>Privacy</h2>
    <p>You can use the whole course without an account; your progress stays in this browser. If you make an account, we store your email (to sign you in), your nickname, your progress, quiz answers and notes, so you can pick up on any device. Other users can't see them, and we never share them. The leaderboard shows only your nickname, level and XP. We don't sell or share your data and there are no ads or trackers. You can export or delete everything from the <a href="#/account">account page</a> at any time. Data is held by Supabase on servers in the EU. Under UK GDPR you can ask what we hold, have it corrected or deleted. <a href="privacy.html">Full privacy notice</a>.</p>
    <h2>Sources and figures</h2>
    <p>Facts come from primary sources where possible: gov.uk, HMRC, the Bank of England, the ONS, the FCA and MoneyHelper. Figures that change are checked regularly:</p>
    <ul class="sources">${figs.map(f => `<li><strong>${esc(f.label)}:</strong> ${esc(f.display)} (${esc(f.asOf)}). <a href="${esc(f.url)}">${esc(f.source)}</a>, checked ${esc(niceDate(f.checked))}.</li>`).join('')}</ul>
  </article>`, { title: 'About' });
}

// ---------- popovers (glossary terms and figure notes) ----------
function wireTerms(root) {
  root.addEventListener('click', e => {
    const t = e.target.closest('.term, .fig-chip');
    if (!t) return;
    e.stopPropagation();
    let html;
    if (t.classList.contains('term')) {
      const g = glossary[t.dataset.term];
      const m = g && itemById(g.module);
      html = g ? `<strong>${esc(g.term)}</strong><p>${esc(g.def)}</p><a href="${base()}/glossary?t=${encodeURIComponent(t.dataset.term)}">Open in glossary</a>${m && m.kind === 'module' ? ` · <span>Module ${m.num}</span>` : ''}` : 'Not in the glossary yet.';
    } else {
      const f = figures.figures[t.dataset.fig];
      html = `<strong>${esc(f.label)}: ${esc(f.display)}</strong><p>${esc(f.asOf)}.</p><p>Source: <a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.source)}</a>. Checked ${esc(niceDate(f.checked))}.</p>`;
    }
    showPopover(t, html);
  });
}

function showPopover(anchor, html) {
  closePopover();
  const pop = el(`<div class="popover" role="dialog">${html}<button type="button" class="pop-close" aria-label="Close">×</button></div>`);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const w = Math.min(320, window.innerWidth - 32);
  pop.style.width = `${w}px`;
  pop.style.left = `${Math.max(16, Math.min(window.innerWidth - w - 16, r.left + r.width / 2 - w / 2)) + window.scrollX}px`;
  pop.style.top = `${r.bottom + 8 + window.scrollY}px`;
  pop.querySelector('.pop-close').addEventListener('click', closePopover);
  pop.querySelector('.pop-close').focus({ preventScroll: true });
}
function closePopover() { document.querySelectorAll('.popover').forEach(p => p.remove()); }
document.addEventListener('click', e => { if (!e.target.closest('.popover')) closePopover(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePopover(); });

function toast(text) {
  const t = el(`<div class="toast" role="status">${esc(text)}</div>`);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

// ---------- router ----------
async function route() {
  cleanup.forEach(fn => fn()); cleanup = [];
  closePopover();
  const raw = location.hash.slice(1);
  const [path, query] = (raw.startsWith('/') ? raw : '/').split('?');
  const params = new URLSearchParams(query || '');
  const parts = path.split('/').filter(Boolean);
  // Old Money links (#/m/01, #/cp/1, #/glossary?t=…) keep working.
  // and so does the old strand filter on the home page (#/?strand=money), now the course map's.
  if (['m', 'cp', 'glossary'].includes(parts[0]) || (!parts.length && params.has('strand'))) {
    location.replace(`#/c/${registry.default}${path === '/' ? '' : path}${query ? `?${query}` : ''}`);
    return;
  }
  try {
    if (!parts.length) { await useCourse(registry.default); await viewDashboard(); }
    else if (parts[0] === 'refresh') { await useCourse(registry.default); await viewRefresh(); }
    else if (parts[0] === 'c') {
      if (!(await useCourse(parts[1]))) return viewNotFound();
      if (entry.needsAccount && sync.signedIn()) await sync.settled();
      if (entry.needsAccount && !sync.hasNickname() && !sync.isAdmin()) return viewNeedsAccount();
      const sub = parts[2];
      if (!sub) viewHome(params);
      else if (sub === 'm') await viewModule(parts[3]);
      else if (sub === 'cp') await viewCheckpoint(parts[3]);
      else if (sub === 'glossary') viewGlossary(params);
      else viewNotFound();
    }
    else if (parts[0] === 'leaderboard') { await useCourse(registry.default); await viewLeaderboard(); }
    else if (['classes', 'join', 'teach'].includes(parts[0])) {
      await useCourse(registry.default);
      await sync.settled();
      const ctx = { shell, app, sync, registry, loadCourse: async id => (await loadCourseById(id))?.course };
      if (parts[0] === 'join') await viewJoin(ctx, parts[1]);
      else if (parts[0] === 'teach') await (parts[1] ? viewTeachClass(ctx, parts[1]) : viewTeach(ctx));
      else await (parts[1] ? viewClassBoard(ctx, parts[1]) : viewClasses(ctx));
    }
    else if (parts[0] === 'account') await viewAccount();
    else if (parts[0] === 'about') viewAbout();
    else viewNotFound();
    maybeShowSignup(parts);
  } catch (e) {
    console.error(e);
    app.innerHTML = `<main class="page"><div class="card"><h1>Something went wrong</h1><p>${esc(e.message)}</p><a class="btn" href="#/">Home</a></div></main>`;
  }
}

async function start() {
  [registry, figures] = await Promise.all([loadRegistry(), loadFigures()]);
  await useCourse(registry.default);
  let wasAdmin = false;
  let plansWere = sync.plansKey();
  await sync.init(progress, () => {
    if (sync.isAdmin() !== wasAdmin || sync.plansKey() !== plansWere) { wasAdmin = sync.isAdmin(); plansWere = sync.plansKey(); route(); } else refreshStrip();
  });
  window.addEventListener('hashchange', route);
  route();
}
start();
