// Router and views. Hash routes: #/, #/m/<id>, #/cp/<n>, #/glossary, #/leaderboard, #/account, #/about
import { esc, el, niceDate } from './util.js';
import { loadCourse, loadFigures, loadGlossary, loadLesson, loadQuiz, loadPools } from './content.js';
import { Progress, courseStatus, levelFor, pickRecall, XP_RULES } from './progress.js';
import { buildAttempt, buildCheckpoint, instantiate } from './quiz.js';
import { runQuiz } from './quizui.js';
import { parseLesson, hydrateBlocks } from './lesson.js';
import * as sync from './sync.js';

const progress = new Progress();
const app = document.getElementById('app');
let course, figures, glossary;
let cleanup = [];

// ---------- theme ----------
const THEME_KEY = 'compound.theme';
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
try { applyTheme(localStorage.getItem(THEME_KEY)); } catch { /* blocked */ }
function cycleTheme() {
  const cur = document.documentElement.dataset.theme;
  const dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch { /* blocked */ }
}

// ---------- shared bits ----------
const strandOf = item => (item.strand ? course.strands[item.strand] : null);
const itemById = id => course.items.find(i => i.id === id);

function statusMap() { return courseStatus(course.items, progress, course.ready); }

function gameStrip() {
  const xp = progress.xp().total;
  const lv = levelFor(xp);
  const rank = sync.myRank();
  const pct = Math.round((lv.into / lv.need) * 100);
  return `<a class="strip" href="#/leaderboard" aria-label="Level ${lv.level}, ${lv.into} of ${lv.need} XP to next level, ${progress.streak()} day streak${rank ? `, rank ${rank}` : ''}. Open leaderboard">
    <span class="lv">Lv ${lv.level}</span>
    <span class="xpbar"><span class="track"><span style="width:${pct}%"></span></span><span class="xptext">${xp} XP · ${lv.to - xp} to level ${lv.level + 1}</span></span>
    <span class="streak" title="Days in a row">🔥 ${progress.streak()}</span>
    <span class="rank">${rank ? `#${rank}` : '🏆'}</span>
  </a>`;
}

function refreshStrip() {
  const s = document.querySelector('.strip');
  if (s) s.outerHTML = gameStrip();
}

function shell(main, { title } = {}) {
  document.title = title ? `${title} · Compound` : 'Compound: a free UK finance course';
  app.innerHTML = `
    <header class="top">
      <a class="brand" href="#/"><span class="logo" aria-hidden="true">£</span><span>Compound</span></a>
      <nav class="top-nav" aria-label="Main">
        <a href="#/glossary" class="icon-link" aria-label="Glossary"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M6.5 17A2.5 2.5 0 0 0 4 19.5 2.5 2.5 0 0 0 6.5 22H20v-5"/></svg></a>
        <button type="button" class="icon-link theme-btn" aria-label="Switch light or dark mode"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button>
        <a href="#/account" class="icon-link" aria-label="Account"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg></a>
      </nav>
    </header>
    <div class="read-progress" hidden><span></span></div>
    ${gameStrip()}
    <main class="page">${main}</main>
    <footer class="foot">
      <p><strong>Education only, not financial advice.</strong> Trading in this course is paper only.</p>
      <p>UK rules (England, Wales and Northern Ireland; Scotland flagged where income tax differs). Every changing figure shows when it was checked.</p>
      <p>Made by Ivor Fergusson · <a href="#/about">About and sources</a> · <a href="privacy.html">Privacy</a></p>
    </footer>`;
  app.querySelector('.theme-btn').addEventListener('click', cycleTheme);
  window.scrollTo(0, 0);
}

function lockIcon() {
  return `<svg class="lock" viewBox="0 0 24 24" role="img" aria-label="Locked"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
}

function itemCard(item, s) {
  const strand = strandOf(item);
  const locked = s.state === 'locked' || s.state === 'soon';
  const href = item.kind === 'checkpoint' ? `#/cp/${item.num}` : `#/m/${item.id}`;
  const icon = item.kind === 'checkpoint' ? '✏️' : item.kind === 'intro' ? '👋' : strand.emoji;
  const kicker = item.kind === 'checkpoint' ? `Checkpoint · modules ${item.covers[0]}–${item.covers[1]}`
    : item.kind === 'intro' ? 'Start here' : `${item.num} · ${strand.name}${item.strand === 'trading' ? ' (paper only)' : ''}`;
  const right = s.state === 'locked' ? lockIcon()
    : s.state === 'soon' ? '<span class="tag">Soon</span>'
    : s.state === 'passed' ? `<span class="tag good">Passed${s.best != null ? ` · ${s.best}%` : ''}</span>`
    : s.state === 'done' ? '<span class="tag good">Done</span>'
    : s.best != null ? `<span class="tag warm">${s.best}% · retake</span>` : '<span class="tag accent">Start</span>';
  const inner = `<span class="ic strand-${item.strand || item.kind}" aria-hidden="true">${icon}</span>
    <span class="txt"><span class="kicker strand-text-${item.strand || item.kind}">${esc(kicker)}</span><span class="name">${esc(item.short || item.title)}</span>${locked ? `<span class="why-locked">${esc(s.reason)}</span>` : ''}</span>${right}`;
  return locked
    ? `<div class="item locked ${item.kind}">${inner}</div>`
    : `<a class="item ${item.kind} ${s.state === 'open' && s.best == null && item.kind !== 'intro' ? 'current' : ''}" href="${href}">${inner}</a>`;
}

// ---------- views ----------
function viewHome(params) {
  const st = statusMap();
  const filter = params.get('strand') || 'all';
  const modules = course.items.filter(i => i.kind === 'module');
  const passedCount = modules.filter(i => st[i.id].state === 'passed').length;
  const fresh = !progress.state.attempts.length && !Object.keys(progress.state.read).length;
  const next = (fresh && course.items[0]) || course.items.find(i => i.kind !== 'intro' && st[i.id].state === 'open') || course.items[0];
  const nextStrand = strandOf(next);
  const ns = st[next.id];

  const levels = ['Start here', 'Beginner', 'Intermediate', 'Advanced', 'Expert'];
  let lastLevel = null;
  let list = '';
  for (const item of course.items) {
    if (filter !== 'all' && item.kind === 'module' && item.strand !== filter) continue;
    if (filter !== 'all' && item.kind !== 'module') continue;
    const lvl = item.level || lastLevel;
    if (item.kind !== 'checkpoint' && lvl !== lastLevel && levels.includes(lvl)) {
      list += `<h3 class="section-label">${esc(lvl === 'Expert' ? 'Capstones' : lvl)}</h3>`;
      lastLevel = lvl;
    }
    list += itemCard(item, st[item.id]);
  }

  const chips = [['all', 'All', '']].concat(Object.entries(course.strands).map(([k, s]) => [k, s.name, s.emoji]))
    .map(([k, name, emoji]) => `<a class="chip strand-chip-${k} ${filter === k ? 'on' : ''}" href="#/${k === 'all' ? '' : '?strand=' + k}" ${filter === k ? 'aria-current="true"' : ''}>${emoji ? emoji + ' ' : ''}${esc(name)}</a>`).join('');

  const strandTotals = Object.entries(course.strands).map(([k, s]) => {
    const mine = modules.filter(m => m.strand === k);
    const done = mine.filter(m => st[m.id].state === 'passed').length;
    return `<a class="strand-tile strand-${k}" href="#/?strand=${k}"><span aria-hidden="true">${s.emoji}</span><span>${esc(s.name)}</span><strong>${done} / ${mine.length}</strong></a>`;
  }).join('');

  shell(`
    <section class="card hero">
      <span class="eyebrow">${progress.state.attempts.length || Object.keys(progress.state.read).length ? 'Pick up where you left off' : 'Welcome'}</span>
      ${nextStrand ? `<span class="pill strand-pill-${next.strand}">${nextStrand.emoji} ${esc(nextStrand.name)} · module ${next.num}</span>` : ''}
      <h1>${esc(next.title)}</h1>
      <p class="muted">${esc(next.summary)}</p>
      ${ns.best != null ? `<p>Best quiz score <strong>${ns.best}%</strong>. Score ${Math.round(course.passMark * 100)}% to unlock the next module.</p>` : ''}
      <a class="btn wide" href="${next.kind === 'checkpoint' ? `#/cp/${next.num}` : `#/m/${next.id}`}">${ns.best != null ? 'Carry on' : next.kind === 'intro' ? 'Start the course' : 'Start'}</a>
    </section>
    <section class="overall">
      <div class="row-between"><h2>Your course</h2><span class="muted">${passedCount} of ${modules.length} passed</span></div>
      <div class="bar"><span style="width:${(passedCount / modules.length) * 100}%"></span></div>
      <div class="strand-tiles">${strandTotals}</div>
    </section>
    <nav class="chips" aria-label="Filter by strand">${chips}</nav>
    <section class="items">${list}</section>`);
}

async function viewModule(id) {
  const item = itemById(id);
  if (!item || item.kind === 'checkpoint') return viewNotFound();
  const st = statusMap()[id];
  if (st.state === 'locked' || st.state === 'soon') return viewLocked(item, st);
  const strand = strandOf(item);
  const [md, quiz] = await Promise.all([loadLesson(id), loadQuiz(id)]);
  const { sections, blocks } = parseLesson(md, { figures, glossary });
  const minutes = Math.max(5, Math.round(md.split(/\s+/).length / 200) + (quiz ? 10 : 0) + blocks.length);

  const sectionHtml = sections.map((s, k) => `<section class="lesson-section" id="s${k}">${s.title ? `<h2>${esc(s.title)}</h2>` : ''}${s.html}</section>`).join('');
  const isTrading = item.strand === 'trading';
  shell(`
    <article class="lesson">
      <header class="lesson-head">
        ${strand ? `<span class="pill strand-pill-${item.strand}">${strand.emoji} ${esc(strand.name)} · ${esc(item.level)}</span>` : '<span class="pill">Start here</span>'}
        <h1>${esc(item.title)}</h1>
        <p class="muted">About ${minutes} minutes${item.buildsOn.length ? ` · builds on ${item.buildsOn.map(n => n === 0 ? 'the introduction' : `module ${n}`).join(', ')}` : ''}</p>
        ${isTrading ? `<aside class="callout callout-paper"><span class="eyebrow">Paper trading only</span><p>Education only, not financial advice. Practise with pretend money; most people who trade with real money lose it.</p></aside>` : ''}
      </header>
      ${item.num > 1 ? '<section class="recall" id="recall"></section>' : ''}
      ${sectionHtml}
      <section class="card own-words" id="own-words">
        <h2>In my own words</h2>
        <p class="muted">Explain it as if to a friend. Note anything that confused you. ${sync.signedIn() ? 'Saved to your account.' : 'Saved in this browser; make an account to keep it.'}</p>
        <textarea rows="6" aria-label="In my own words">${esc(progress.state.notes[id]?.text || '')}</textarea>
        <span class="saved-note" aria-live="polite"></span>
      </section>
      ${quiz ? `<section class="quiz-wrap" id="quiz"><h2>Module quiz</h2><p class="muted">${quiz.pick} questions. Score ${Math.round(course.passMark * 100)}% to pass${nextItemLabel(item)}. Retry as often as you like; your best attempt counts.</p><div class="quiz"></div></section>` : ''}
      ${nav(item)}
    </article>`, { title: item.short || item.title });

  const article = app.querySelector('.lesson');
  hydrateBlocks(article, blocks, { progress, moduleId: id });
  wireTerms(article);
  wireOwnWords(article, id);
  wireReading(article, id);
  if (item.num > 1) mountRecall(article.querySelector('#recall'), item);
  if (quiz) mountModuleQuiz(article.querySelector('.quiz'), item, quiz);
}

function nextItemLabel(item) {
  const idx = course.items.indexOf(item);
  const next = course.items[idx + 1];
  if (!next || item.kind === 'intro') return '';
  return next.kind === 'checkpoint' ? ` and unlock ${next.title.toLowerCase()}` : ` and unlock module ${next.num}`;
}

function nav(item) {
  const idx = course.items.indexOf(item);
  const prev = course.items[idx - 1], next = course.items[idx + 1];
  const link = (it, dir) => it ? `<a class="nav-${dir}" href="${it.kind === 'checkpoint' ? `#/cp/${it.num}` : `#/m/${it.id}`}"><span class="muted">${dir === 'prev' ? '← Previous' : 'Next →'}</span><span>${esc(it.short || it.title)}</span></a>` : '<span></span>';
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
    if (p >= 1 && progress.markRead(id)) { refreshStrip(); sync.pushSoon(); toast('Module read: +20 XP'); }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  cleanup.push(() => window.removeEventListener('scroll', onScroll));
  onScroll();
}

async function mountRecall(box, item) {
  const pools = await loadPools(course, item.num - 1);
  const picked = pickRecall(progress, pools, item.num, 4);
  if (!picked.length) { box.remove(); return; }
  box.innerHTML = `<div class="recall-intro card"><span class="eyebrow">Recall check · ${picked.length} quick questions</span><p>Questions from earlier modules, starting with ones you've missed before. Recalling beats rereading.</p><button type="button" class="btn">Start recall check</button><button type="button" class="btn ghost skip">Skip for now</button></div>`;
  box.querySelector('.skip').addEventListener('click', () => box.remove());
  box.querySelector('.btn:not(.skip)').addEventListener('click', () => {
    const qs = picked.map(q => ({ ...instantiate(q, { randomise: true }), module: q.module }));
    runQuiz(box, qs, {
      kind: 'recall', title: 'Recall check', passMark: 0,
      onFinish: s => {
        progress.recordAttempt({ kind: 'recall', id: item.id, auto: s.auto, outOf: s.outOf, results: s.results });
        refreshStrip(); sync.pushSoon();
        return `<p class="muted">Now on to the lesson.</p>`;
      },
    });
  });
}

function mountModuleQuiz(box, item, quiz) {
  const start = () => {
    const tries = progress.attemptsFor(item.id).length;
    const qs = buildAttempt(quiz.questions, quiz.pick, { randomise: tries > 0 }).map(q => ({ ...q, module: item.num }));
    const xpBefore = progress.xp().total;
    const wasPassed = progress.passed(item.id);
    runQuiz(box, qs, {
      kind: 'quiz', title: `Module ${item.num} quiz`, passMark: course.passMark,
      onRetry: start,
      onFinish: s => {
        progress.recordAttempt({ kind: 'quiz', id: item.id, ...s });
        sync.pushSoon();
        const gained = progress.xp().total - xpBefore;
        refreshStrip();
        const idx = course.items.indexOf(item);
        const next = course.items[idx + 1];
        let html = `<p class="muted">${gained > 0 ? `+${gained} XP` : 'No new XP: XP counts your best auto-marked score once.'}</p>`;
        if (s.passed && !wasPassed && next) {
          html += `<a class="btn wide" href="${next.kind === 'checkpoint' ? `#/cp/${next.num}` : `#/m/${next.id}`}">Unlocked: ${esc(next.short || next.title)} →</a>`;
        } else if (!s.passed && next) {
          html += `<p>${esc(next.kind === 'checkpoint' ? next.title : `Module ${next.num}`)} stays locked until you pass. Retries use new questions and new numbers.</p>`;
        }
        return html;
      },
    });
  };
  const best = progress.best(item.id);
  box.innerHTML = `<div class="card"><p>${best ? `Your best: <strong>${Math.round(((best.auto + best.claimed) / best.outOf) * 100)}%</strong>. ` : ''}Ready when you are. Each question shows the right answer and why straight after you answer.</p><button type="button" class="btn wide">${best ? 'Retake the quiz' : 'Start the quiz'}</button></div>`;
  box.querySelector('button').addEventListener('click', start);
}

async function viewCheckpoint(num) {
  const item = course.items.find(i => i.kind === 'checkpoint' && i.num === +num);
  if (!item) return viewNotFound();
  const st = statusMap()[item.id];
  if (st.state === 'locked' || st.state === 'soon') return viewLocked(item, st);
  shell(`<article class="lesson"><header class="lesson-head"><span class="pill">✏️ Checkpoint ${item.num}</span><h1>${esc(item.title)}</h1>
    <p class="muted">${esc(item.summary)} About 20 minutes. Pass mark ${Math.round(course.passMark * 100)}%.</p></header><div class="quiz"></div>${nav(item)}</article>`, { title: item.title });
  const box = app.querySelector('.quiz');
  const pools = await loadPools(course, item.covers[1]);
  const start = () => {
    const xpBefore = progress.xp().total;
    const qs = buildCheckpoint(pools, item.covers, { size: item.num === 4 ? 20 : 18 });
    runQuiz(box, qs, {
      kind: 'checkpoint', title: item.title, passMark: course.passMark, onRetry: start,
      onFinish: s => {
        progress.recordAttempt({ kind: 'checkpoint', id: item.id, ...s });
        sync.pushSoon(); refreshStrip();
        return `<p class="muted">+${progress.xp().total - xpBefore} XP</p>`;
      },
    });
  };
  box.innerHTML = `<div class="card"><p>Questions from every module so far, mostly the latest eight.</p><button type="button" class="btn wide">Start the checkpoint</button></div>`;
  box.querySelector('button').addEventListener('click', start);
}

function viewLocked(item, st) {
  shell(`<section class="card locked-view">${lockIcon()}<h1>${esc(item.title)}</h1><p>${esc(st.reason)}.</p>
    <p class="muted">${esc(item.summary || '')}</p><a class="btn" href="#/">Back to the course</a></section>`, { title: item.title });
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
      return `<div class="g-item" id="t-${esc(k.replace(/\W+/g, '-'))}" data-k="${esc((g.term + ' ' + g.def).toLowerCase())}"><dt>${esc(g.term)}</dt><dd>${esc(g.def)}<a class="small" href="#/m/${m.id}">${m.kind === 'intro' ? 'Introduction' : `Module ${m.num}: ${esc(m.short)}`}</a></dd></div>`;
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

async function viewAccount() {
  const notes = Object.entries(progress.state.notes).filter(([, n]) => n.text.trim());
  shell(`<h1>Your account</h1>
    <section class="card" id="auth-box">${await sync.authPanel()}</section>
    <section class="card"><h2>My notes</h2>${notes.length ? notes.map(([id, n]) => {
      const m = itemById(id);
      return `<div class="note"><a href="#/m/${id}">${m.kind === 'intro' ? 'Introduction' : `Module ${m.num}: ${esc(m.short)}`}</a><p>${esc(n.text)}</p><span class="small muted">${esc(niceDate(n.at))}</span></div>`;
    }).join('') : '<p class="muted">Your "In my own words" notes will show here.</p>'}</section>
    <section class="card"><h2>Your data</h2>
      <p>Download everything this course holds about you, as a JSON file.</p>
      <button type="button" class="btn ghost export">Export my data</button>
      <h3>Delete</h3>
      <p>${sync.signedIn() ? 'Deletes your account and every row of your data, for good.' : 'Clears your progress from this browser.'}</p>
      <button type="button" class="btn danger delete">${sync.signedIn() ? 'Delete my account' : 'Clear my progress'}</button>
    </section>
    <section class="card"><h2>Appearance</h2><button type="button" class="btn ghost theme2">Switch light or dark mode</button></section>`, { title: 'Account' });
  sync.wireAuthPanel(app.querySelector('#auth-box'), () => route());
  app.querySelector('.theme2').addEventListener('click', cycleTheme);
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
      <li><strong>${R.firstPassModule} XP</strong> the first time you pass a module quiz, and <strong>${R.firstPassCheckpoint} XP</strong> for a checkpoint. The pass needs ${Math.round(course.passMark * 100)}% from auto-marked answers.</li>
      <li><strong>${R.perRecall} XP</strong> per right answer in a module's first recall check each day.</li>
      <li><strong>${R.perDay} XP</strong> for each day you do something, and <strong>${R.streakWeek} XP</strong> for every 7 days in a row.</li>
      <li><strong>Claimed marks</strong> ("I had this") help you pass and unlock the next module, but never earn XP. That keeps the leaderboard fair.</li>
      <li>Levels get further apart as you go: level 2 at 100 XP, level 3 at 300, level 4 at 600, level 5 at 1,000.</li>
    </ul>
    <h2>Privacy</h2>
    <p>You can use the whole course without an account; your progress stays in this browser. If you make an account, we store your email (to sign you in), your nickname, your progress, quiz answers and notes, so you can pick up on any device. Nobody else can see them. The leaderboard shows only your nickname, level and XP. We don't sell or share your data and there are no ads or trackers. You can export or delete everything from the <a href="#/account">account page</a> at any time. Data is held by Supabase on servers in the EU. Under UK GDPR you can ask what we hold, have it corrected or deleted. <a href="privacy.html">Full privacy notice</a>.</p>
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
      html = g ? `<strong>${esc(g.term)}</strong><p>${esc(g.def)}</p><a href="#/glossary?t=${encodeURIComponent(t.dataset.term)}">Open in glossary</a>${m && m.kind === 'module' ? ` · <span>Module ${m.num}</span>` : ''}` : 'Not in the glossary yet.';
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
  try {
    if (!parts.length) viewHome(params);
    else if (parts[0] === 'm') await viewModule(parts[1]);
    else if (parts[0] === 'cp') await viewCheckpoint(parts[1]);
    else if (parts[0] === 'glossary') viewGlossary(params);
    else if (parts[0] === 'leaderboard') await viewLeaderboard();
    else if (parts[0] === 'account') await viewAccount();
    else if (parts[0] === 'about') viewAbout();
    else viewNotFound();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<main class="page"><div class="card"><h1>Something went wrong</h1><p>${esc(e.message)}</p><a class="btn" href="#/">Home</a></div></main>`;
  }
}

async function start() {
  [course, figures, glossary] = await Promise.all([loadCourse(), loadFigures(), loadGlossary()]);
  await sync.init(progress, () => { refreshStrip(); });
  window.addEventListener('hashchange', route);
  route();
}
start();
