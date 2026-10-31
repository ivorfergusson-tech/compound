// Past papers: a catalogue of links (we never host papers), the next paper, logging marks, consolidation and a gallery.
import { esc, el } from './util.js';
import { questionCard } from './quizui.js';
import { buildAttempt } from './quiz.js';
import { problemFor, say, twoStep, date } from './classes.js';

// ---------- pure helpers (tested in tools/papers_test.mjs) ----------
export const pctOf = (got, outOf) => (Number(outOf) ? Math.round((Number(got) / Number(outOf)) * 100) : 0);

// Oldest first, specimens last, and never one the teacher is keeping back.
export function nextPaper(papers, attempts, reserved = []) {
  const done = new Set(attempts.map(a => a.paper_id));
  return papers.find(p => !done.has(p.id) && !reserved.includes(p.id)) || null;
}

// Biggest losses first, grouped by topic. items: [{ q, got, out_of, spec }]
export function lostTopics(items, count = 2) {
  const by = new Map();
  for (const i of items) if (i.spec) by.set(i.spec, (by.get(i.spec) || 0) + (i.out_of - i.got));
  return [...by.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, count).map(([spec, lost]) => ({ spec, lost }));
}

// Scales the last 3 papers up to the whole qualification and reads off the published boundaries. A rough guide only.
export function roughGrade(attempts, b) {
  if (!b || attempts.length < 3) return null;
  const last = [...attempts].sort((x, y) => String(y.done_on).localeCompare(String(x.done_on))).slice(0, 3);
  const got = last.reduce((n, a) => n + a.got, 0), of = last.reduce((n, a) => n + a.out_of, 0);
  if (!of) return null;
  const scaled = Math.round((got / of) * b.max);
  const grade = Object.entries(b.grades).find(([, at]) => scaled >= at)?.[0] || 'U';
  return { grade, scaled, pct: pctOf(got, of) };
}

// One long question that a class sits on paper and photographs. The mark scheme goes to the teacher only.
export function paperItem(p) {
  const links = [{ label: 'Question paper', url: p.qp }];
  if (p.insert) links.push({ label: 'Insert', url: p.insert });
  return { kind: 'question', id: `paper:${p.id}`, marks: p.marks, q: { type: 'long', marks: p.marks, text: `AQA ${p.series}, ${p.name}. Sit the paper on paper, then photograph each page.`, links, scheme: p.ms } };
}

export function cleanItems(rows) {
  const items = [];
  for (const r of rows) {
    const got = Number(r.got), outOf = Number(r.out_of);
    if (r.got === '' && r.out_of === '') continue;
    if (!Number.isInteger(got) || !Number.isInteger(outOf) || outOf < 1 || outOf > 50 || got < 0 || got > outOf) return { problem: `Check question ${r.q || items.length + 1}: marks must be whole numbers, no more than it was out of.` };
    items.push({ q: String(r.q || items.length + 1).slice(0, 10), got, out_of: outOf, spec: r.spec || '' });
  }
  return items.length ? { items } : { problem: 'Add the marks for at least one question.' };
}

// ---------- pages ----------
const topicName = (course, s) => course.strands?.[s]?.name || s;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayKey = id => `compound.paperDay.${id}`;
const getDay = id => { try { return localStorage.getItem(dayKey(id)) || ''; } catch { return ''; } };
const setDay = (id, v) => { try { localStorage.setItem(dayKey(id), v); } catch { /* only a reminder */ } };
const links = p => [['QP', p.qp], ['MS', p.ms], ['Insert', p.insert]].filter(([, u]) => u).map(([n, u]) => `<a class="btn ghost" href="${esc(u)}" target="_blank" rel="noopener">${n}</a>`).join('');
const gate = ({ shell, sync, course }) => {
  if (sync.signedIn() && sync.hasNickname()) return true;
  shell(`<section class="card"><h1>Past papers</h1><p>You need a free account to log your marks.</p><a class="btn" href="#/account">Make an account or sign in</a></section>`, { title: `Past papers · ${course.name}` });
  return false;
};

export async function viewPapers(ctx) {
  const { shell, app, sync, course, files } = ctx;
  if (!gate(ctx)) return;
  const [data, attempts, reserved] = await Promise.all([files.papers(), sync.rpc('my_papers', { p_course: course.id }), sync.rpc('my_reserved_papers', { p_course: course.id })]);
  const held = reserved.map(r => r.paper_id);
  const next = nextPaper(data.papers, attempts, held);
  const rough = roughGrade(attempts, data.boundaries);
  const byId = new Map(data.papers.map(p => [p.id, p]));
  const list = data.papers.filter(p => !held.includes(p.id));
  const b = data.boundaries;
  shell(`<a class="small" href="#/c/${esc(course.id)}">← ${esc(course.name)}</a><h1>Past papers</h1>
    <p class="muted">Links open the papers on ${esc(data.papers[0]?.source || 'another site')}. We don't host them. Mark your own work with the mark scheme, then log it here.</p>
    <section class="card"><h2>Next paper</h2>${next ? `<p><strong>${esc(next.series)}, ${esc(next.name)}</strong></p><p class="small muted">${esc(next.marks)} marks, ${esc(next.minutes)} minutes</p>
      <div class="row-actions">${links(next)}<a class="btn" href="#/c/${esc(course.id)}/papers/log/${esc(next.id)}">Log marks</a></div>` : '<p class="muted">You\'ve done them all.</p>'}
      <label class="field">Your paper day<select class="paper-day"><option value="">Not set</option>${DAYS.map(d => `<option${getDay(course.id) === d ? ' selected' : ''}>${d}</option>`).join('')}</select></label></section>
    <section class="card"><h2>Rough grade</h2>${rough ? `<p class="join-big">${esc(rough.grade)}</p><p class="small muted">Your last 3 papers average ${esc(rough.pct)}%, about ${esc(rough.scaled)} of ${esc(b.max)}. This is a rough guide: you marked them yourself, and boundaries change each year.</p>` : '<p class="muted">Log 3 papers to see a rough grade.</p>'}
      ${b ? `<p class="small muted">Boundaries: ${esc(b.series)}, from <a href="${esc(b.source)}" target="_blank" rel="noopener">${esc(b.sourceName)}</a>, checked ${esc(date(b.checked))}. <a href="${esc(b.official)}" target="_blank" rel="noopener">AQA's own figures</a>.</p>` : ''}</section>
    ${attempts.length ? `<section class="card"><h2>Papers you've done</h2><div class="paper-gallery">${attempts.map(a => {
      const p = byId.get(a.paper_id), pc = pctOf(a.got, a.out_of);
      const lost = lostTopics(a.items);
      return `<a class="paper-card" href="#/c/${esc(course.id)}/papers/a/${esc(a.id)}"><strong>${esc(p ? `${p.series}, Paper ${p.paper}` : a.paper_id)}</strong>
        <span class="small muted">${esc(date(a.done_on))} · ${esc(a.got)}/${esc(a.out_of)} · ${pc}%</span><span class="paper-bar"><span style="width:${pc}%"></span></span>
        ${lost.length ? `<span class="small">Lost most on: ${lost.map(l => esc(topicName(course, l.spec))).join(', ')}</span>` : ''}
        ${a.cons_of ? `<span class="small muted">Consolidation ${esc(a.cons_got)}/${esc(a.cons_of)}</span>` : ''}</a>`;
    }).join('')}</div></section>` : ''}
    <section class="card"><h2>All papers</h2><div class="table-scroll" tabindex="0" role="region" aria-label="All past papers"><table class="roster">
      <thead><tr><th scope="col">Series</th><th scope="col">Paper</th><th scope="col">Files</th><th scope="col"><span class="sr">Log</span></th></tr></thead>
      <tbody>${list.map(p => `<tr><td>${esc(p.series)}</td><td>${esc(p.name)}</td><td class="row-actions">${links(p)}</td><td><a href="#/c/${esc(course.id)}/papers/log/${esc(p.id)}">Log marks</a></td></tr>`).join('')}</tbody></table></div></section>`, { title: `Past papers · ${course.name}`, wide: true });
  app.querySelector('.paper-day').addEventListener('change', e => setDay(course.id, e.target.value));
}

export async function viewLogPaper(ctx, id) {
  const { shell, app, sync, course, files } = ctx;
  if (!gate(ctx)) return;
  const p = (await files.papers()).papers.find(x => x.id === id);
  if (!p) return shell('<section class="card"><h1>Paper not found</h1></section>', { title: 'Past papers' });
  const topics = Object.entries(course.strands).filter(([k]) => /^\d/.test(k));
  const row = n => `<tr><td><input name="q" aria-label="Question" value="${n}" maxlength="10"></td><td><input name="got" type="number" min="0" max="50" aria-label="Marks in question ${n}"></td>
    <td><input name="out" type="number" min="1" max="50" aria-label="Out of, question ${n}"></td><td><select name="spec" aria-label="Topic of question ${n}"><option value="">Choose a topic</option>${topics.map(([k, v]) => `<option value="${esc(k)}">${esc(k)} ${esc(v.name)}</option>`).join('')}</select></td></tr>`;
  shell(`<a class="small" href="#/c/${esc(course.id)}/papers">← Past papers</a><h1>Log marks</h1><p class="muted">${esc(p.series)}, ${esc(p.name)}</p>
    <form class="log-form card"><label class="field">Date you sat it<input type="date" name="done" value="${new Date().toISOString().slice(0, 10)}" required></label>
      <div class="table-scroll"><table class="log-table"><thead><tr><th scope="col">Q</th><th scope="col">Marks</th><th scope="col">Out of</th><th scope="col">Topic</th></tr></thead><tbody>${[1, 2, 3, 4].map(row).join('')}</tbody></table></div>
      <button type="button" class="btn ghost add-row">Add a question</button> <button class="btn">Save</button><p class="auth-msg" role="alert"></p></form>`, { title: 'Log marks', wide: true });
  const body = app.querySelector('.log-table tbody');
  app.querySelector('.add-row').addEventListener('click', () => body.insertAdjacentHTML('beforeend', row(body.children.length + 1)));
  app.querySelector('.log-form').addEventListener('submit', async e => {
    e.preventDefault();
    const rows = [...body.children].map(tr => ({ q: tr.querySelector('[name=q]').value, got: tr.querySelector('[name=got]').value, out_of: tr.querySelector('[name=out]').value, spec: tr.querySelector('[name=spec]').value }));
    const { items, problem } = cleanItems(rows);
    if (problem) return say(app, problem);
    try {
      const a = await sync.rpc('log_paper', { p_course: course.id, p_paper: id, p_done: e.target.done.value, p_items: items });
      location.hash = `#/c/${course.id}/papers/a/${a}`;
    } catch (err) { say(app, problemFor(err)); }
  });
}

export async function viewPaperAttempt(ctx, id) {
  const { shell, app, sync, course, files } = ctx;
  if (!gate(ctx)) return;
  const [data, attempts] = await Promise.all([files.papers(), sync.rpc('my_papers', { p_course: course.id })]);
  const a = attempts.find(x => x.id === id);
  if (!a) return shell('<section class="card"><h1>Not found</h1></section>', { title: 'Past papers' });
  const p = data.papers.find(x => x.id === a.paper_id);
  const lost = lostTopics(a.items);
  shell(`<a class="small" href="#/c/${esc(course.id)}/papers">← Past papers</a><h1>${esc(p ? `${p.series}, Paper ${p.paper}` : a.paper_id)}</h1>
    <section class="card"><p class="join-big">${esc(a.got)}/${esc(a.out_of)}</p><p class="muted small">${pctOf(a.got, a.out_of)}%, sat ${esc(date(a.done_on))}. Marked by you.</p>
      <div class="table-scroll" tabindex="0" role="region" aria-label="Marks by question"><table class="roster"><thead><tr><th scope="col">Q</th><th scope="col">Marks</th><th scope="col">Topic</th></tr></thead>
      <tbody>${a.items.map(i => `<tr><td>${esc(i.q)}</td><td>${esc(i.got)}/${esc(i.out_of)}</td><td>${esc(i.spec ? topicName(course, i.spec) : '')}</td></tr>`).join('')}</tbody></table></div>
      <div class="account-actions"><button type="button" class="btn ghost del">Delete this log</button></div></section>
    <section class="card"><h2>Consolidation</h2>${lost.length ? `<p class="small muted">Short questions on the topics you lost most on: ${lost.map(l => esc(topicName(course, l.spec))).join(', ')}.${a.cons_of ? ` Last time: ${esc(a.cons_got)}/${esc(a.cons_of)}.` : ''}</p><div class="cons"></div><p class="auth-msg" role="status" aria-live="polite"></p>` : '<p class="muted">Add a topic to each question when you log a paper, and practice appears here.</p>'}</section>`, { title: 'Past paper' });
  twoStep(app.querySelector('.del'), 'Sure? Delete it', async () => { await sync.rpc('delete_paper', { p_id: id }); location.hash = `#/c/${course.id}/papers`; });
  if (!lost.length) return;
  const wanted = new Set(lost.map(l => l.spec));
  const lessons = course.items.filter(i => i.kind === 'module' && wanted.has(i.strand));
  const pools = await Promise.all(lessons.map(l => files.quiz(l.id)));
  const qs = buildAttempt(pools.flatMap(q => q?.questions || []), 5, { randomise: true });
  const box = app.querySelector('.cons');
  const seen = new Map();
  qs.forEach((q, i) => box.append(questionCard(q, { number: i + 1, onResult: async r => {
    seen.set(i, r);
    if (seen.size < qs.length) return;
    const got = [...seen.values()].reduce((n, x) => n + x.marks, 0), of = [...seen.values()].reduce((n, x) => n + x.outOf, 0);
    await sync.rpc('set_consolidation', { p_id: id, p_got: got, p_of: of }).catch(() => {});
    say(app.querySelector('.cons').parentElement, `Consolidation ${got}/${of} saved.`);
  } })));
}

// On a class page: papers the teacher keeps back, for example for mocks.
export async function drawReserved({ sync, loadPapers }, box, classId, courseId) {
  const data = await loadPapers(courseId).catch(() => null);
  if (!data) return void box.remove();
  const held = new Set(await sync.rpc('class_reserved', { p_class: classId }));
  box.innerHTML = `<h2>Reserve papers</h2><p class="small muted">Reserved papers are hidden from your students' practice list, so you can use them for mocks. You can still set them.</p>
    <details><summary>Choose papers (${held.size} reserved)</summary>${data.papers.map(p => `<label class="check"><input type="checkbox" data-id="${esc(p.id)}"${held.has(p.id) ? ' checked' : ''}> ${esc(p.series)}, ${esc(p.name)}</label>`).join('')}</details><p class="auth-msg" role="status" aria-live="polite"></p>`;
  box.addEventListener('change', async e => {
    try { await sync.rpc('set_reserved', { p_class: classId, p_paper: e.target.dataset.id, p_on: e.target.checked }); } catch (err) { say(box, problemFor(err)); }
  });
}
