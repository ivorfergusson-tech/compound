// Teacher analytics: the class heatmap, a student's profile and the CSV. The numbers come from database functions that
// only answer the class's own teacher. Real names stay on these pages and in the teacher's own download.
import { esc } from './util.js';
import { date, problemFor, say } from './classes.js';

// ---------- pure helpers (tested in tools/analytics_test.mjs) ----------
export const pct = (got, outOf) => (Number(outOf) ? Math.round((Number(got) / Number(outOf)) * 100) : null);
export const topicOf = spec => String(spec || '').split('.').slice(0, 3).join('.');

export function minutes(seconds) {
  const s = Number(seconds) || 0;
  if (!s) return '–';
  return s < 60 ? 'Under 1 min' : `${Math.round(s / 60)} min`;
}

// rows: { user_id, real_name, spec, got, out_of } -> topics in spec order, then students with a cell per topic.
export function heatmap(rows) {
  const topics = [...new Set(rows.map(r => topicOf(r.spec)))].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'en', { numeric: true })));
  const people = new Map();
  for (const r of rows) {
    if (!people.has(r.user_id)) people.set(r.user_id, { id: r.user_id, name: r.real_name, cells: {} });
    const c = people.get(r.user_id).cells;
    const t = (c[topicOf(r.spec)] ||= { got: 0, outOf: 0 });
    t.got += Number(r.got); t.outOf += Number(r.out_of);
  }
  const totals = topics.map(t => {
    const cs = [...people.values()].map(p => p.cells[t]).filter(Boolean);
    return pct(cs.reduce((n, c) => n + c.got, 0), cs.reduce((n, c) => n + c.outOf, 0));
  });
  return { topics, totals, people: [...people.values()] };
}

// Lowest scores first, only where there's something to go on.
export function weakest(rows, count = 3) {
  const by = new Map();
  for (const r of rows) {
    const k = topicOf(r.spec);
    const t = by.get(k) || { topic: k, got: 0, outOf: 0 };
    t.got += Number(r.got); t.outOf += Number(r.out_of);
    by.set(k, t);
  }
  return [...by.values()].filter(t => t.topic && t.outOf).map(t => ({ ...t, pct: pct(t.got, t.outOf) })).sort((a, b) => a.pct - b.pct).slice(0, count);
}

// A cell starting with = + - or @ would run as a formula in a spreadsheet, so names and titles can't carry one in.
export function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (typeof v !== 'number' && /^[\s]*[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function marksCsv(rows) {
  const head = ['Student', 'Left the class', 'Work', 'Due', 'Attempts', 'Best mark', 'Out of', 'Percent', 'First handed in', 'Minutes'];
  const day = iso => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
  const body = rows.map(r => [r.real_name, day(r.left_at), r.title, day(r.due_at), Number(r.attempts), r.best, r.out_of, pct(r.best, r.out_of), day(r.first_submitted), Math.round(Number(r.seconds) / 60)]);
  return [head, ...body].map(line => line.map(csvCell).join(',')).join('\r\n');
}

// ---------- pages ----------
const topicName = (course, t) => (t ? course.strands?.[t]?.name || t : 'Your questions');
// One hue, stronger as the score rises. The figure is always printed, so colour is never the only signal.
const shade = n => (n === null ? '' : ` style="--heat:${Math.round(n * 0.4)}%"`);

async function classFor({ sync }, id) {
  return sync.signedIn() ? (await sync.rpc('teacher_classes')).find(x => x.id === id) : null;
}
const notFound = ({ shell }) => shell('<section class="card"><h1>Class not found</h1><a class="btn" href="#/teach">Back</a></section>', { title: 'Class' });

export async function drawInsightsLink(box, id) {
  box.innerHTML = `<h2>How the class is doing</h2><p class="small muted">Scores by topic, each student's work, and a spreadsheet of marks.</p><a class="btn ghost" href="#/teach/${esc(id)}/insights">See the class's results</a>`;
}

export async function viewInsights(ctx, id) {
  const { shell, app, sync, loadCourse } = ctx;
  const c = await classFor(ctx, id);
  if (!c) return notFound(ctx);
  const [course, rows] = await Promise.all([loadCourse(c.course), sync.rpc('class_heatmap', { p_class: id })]);
  const h = heatmap(rows);
  shell(`<a class="small" href="#/teach/${esc(id)}">← ${esc(c.name)}</a><h1>Class results</h1>
    <section class="card"><h2>Scores by topic</h2>
      ${h.people.length ? `<p class="small muted">Percent of marks from work handed in. A stronger colour means a higher score. A dash means not tried yet.</p>
      <div class="table-scroll" tabindex="0" role="region" aria-label="Scores by student and topic"><table class="heat">
        <thead><tr><th scope="col">Student</th>${h.topics.map(t => `<th scope="col" title="${esc(topicName(course, t))}">${esc(t || 'Own')}</th>`).join('')}</tr></thead>
        <tbody>${h.people.map(p => `<tr><th scope="row"><a href="#/teach/${esc(id)}/student/${esc(p.id)}">${esc(p.name)}</a></th>${h.topics.map(t => {
          const cell = p.cells[t], n = cell ? pct(cell.got, cell.outOf) : null;
          return `<td${shade(n)}${cell ? ` title="${esc(p.name)}, ${esc(topicName(course, t))}: ${esc(cell.got)} of ${esc(cell.outOf)} marks"` : ''}>${n === null ? '–' : `${n}%`}</td>`;
        }).join('')}</tr>`).join('')}</tbody>
        <tfoot><tr><th scope="row">Class</th>${h.totals.map(n => `<td${shade(n)}>${n === null ? '–' : `${n}%`}</td>`).join('')}</tr></tfoot></table></div>
      <details class="small"><summary>What the topics are</summary><ul>${h.topics.map(t => `<li>${esc(t || 'Own')}: ${esc(topicName(course, t))}</li>`).join('')}</ul></details>` : '<p class="muted">Nothing handed in yet.</p>'}</section>
    <section class="card"><h2>Marks spreadsheet</h2><p class="small muted">A CSV file with real names. Keep it somewhere your school allows.</p>
      <button type="button" class="btn ghost csv">Download CSV</button><p class="auth-msg" role="status" aria-live="polite"></p></section>`, { title: 'Class results', wide: true });
  app.querySelector('.csv').addEventListener('click', async () => {
    try {
      const text = marksCsv(await sync.rpc('class_marks', { p_class: id }));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
      a.download = `${c.name.replace(/[^\w -]/g, '').trim() || 'class'} marks.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) { say(app, problemFor(err)); }
  });
}

export async function viewStudent(ctx, id, user) {
  const { shell, sync, loadCourse } = ctx;
  const c = await classFor(ctx, id);
  if (!c) return notFound(ctx);
  let p;
  try { p = await sync.rpc('student_profile', { p_class: id, p_user: user }); } catch { return notFound(ctx); }
  const course = await loadCourse(c.course);
  const low = weakest(p.topics);
  const all = p.work.reduce((n, w) => [n[0] + w.marks, n[1] + w.out_of], [0, 0]);
  shell(`<a class="small" href="#/teach/${esc(id)}/insights">← Class results</a><h1>${esc(p.real_name)}</h1>
    <p class="muted">Joined ${esc(date(p.joined_at))}${p.left_at ? `, left ${esc(date(p.left_at))}` : ''}</p>
    <section class="card profile-facts"><div><strong>${esc(p.passed)}</strong><span class="small muted">lessons passed</span></div>
      <div><strong>${esc(p.streak)}</strong><span class="small muted">day streak</span></div>
      <div><strong>${esc(date(p.last_active)) || '–'}</strong><span class="small muted">last active</span></div>
      <div><strong>${all[1] ? `${pct(all[0], all[1])}%` : '–'}</strong><span class="small muted">of marks on set work</span></div></section>
    <section class="card"><h2>Weakest topics</h2>${low.length ? `<ol>${low.map(t => `<li>${esc(topicName(course, t.topic))}: ${esc(t.pct)}% (${esc(t.got)} of ${esc(t.outOf)} marks)</li>`).join('')}</ol>` : '<p class="muted">Nothing to go on yet.</p>'}</section>
    <section class="card"><h2>Marks over time</h2>${p.work.length ? `<div class="table-scroll" tabindex="0" role="region" aria-label="Marks over time"><table class="roster">
      <thead><tr><th scope="col">Handed in</th><th scope="col">Work</th><th scope="col">Mark</th><th scope="col">Percent</th><th scope="col">Time</th></tr></thead>
      <tbody>${p.work.map(w => `<tr><td>${esc(date(w.submitted_at))}</td><td>${esc(w.title)}${w.attempt > 1 ? ` <span class="muted small">(attempt ${esc(w.attempt)})</span>` : ''}</td><td>${esc(w.marks)}/${esc(w.out_of)}</td><td>${esc(pct(w.marks, w.out_of) ?? '–')}%</td><td>${esc(minutes(w.seconds))}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Time is reported by the student's browser, and stops when the page is hidden or left idle for 2 minutes. Treat it as a guide.</p>` : '<p class="muted">Nothing handed in yet.</p>'}</section>`, { title: p.real_name, wide: true });
}
