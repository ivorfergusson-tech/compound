// The dashboard's sums: where to carry on, how far through each course, what to refresh, the
// weakest spots and a plan for the week before an exam. Pure functions over the progress state.
import { RETIRED } from './progress.js';

// Refresh knowledge sets are stored as recall attempts under this id (5 XP per right answer, once a day).
export const REFRESH_ID = 'rf';
export const REFRESH_SIZE = 6;

// Which course a progress key (or question id) belongs to: bare ones are the default course (Money),
// others are prefixed '<course>:' (see itemKey).
export function courseOfKey(key, defaultId) {
  const i = key.indexOf(':');
  return i < 0 ? { course: defaultId, id: key } : { course: key.slice(0, i), id: key.slice(i + 1) };
}

// Latest activity time (ms) per course id, from reads and attempts.
export function lastActive(state, defaultId) {
  const out = {};
  const see = (key, at) => {
    if (key === REFRESH_ID) return; // cross-course, so it says nothing about where to carry on
    const t = Date.parse(at);
    const c = courseOfKey(key, defaultId).course;
    if (t && !(out[c] >= t)) out[c] = t;
  };
  for (const [k, at] of Object.entries(state.read || {})) see(k, at);
  for (const a of state.attempts || []) see(a.id, a.at);
  return out;
}

// The item to carry on with: the first open one (not passed yet), or null when the course is done.
// A learner who hasn't started gets the first item (the introduction).
export function nextItem(course, st, started) {
  if (!started) return course.items[0];
  return course.items.find(i => i.kind !== 'intro' && st[i.id].state === 'open') || null;
}

export function coursePercent(course, st) {
  const modules = course.items.filter(i => i.kind === 'module');
  const passed = modules.filter(i => st[i.id] && st[i.id].state === 'passed').length;
  return { passed, total: modules.length, pct: modules.length ? Math.round((passed / modules.length) * 100) : 0 };
}

// Missed questions still being learnt, by course and module number, so only those quizzes need loading.
export function srsModules(state, defaultId) {
  const out = {};
  for (const [qid, s] of Object.entries(state.srs || {})) {
    if (s.due === RETIRED || s.module == null) continue;
    const c = courseOfKey(qid, defaultId).course;
    (out[c] = out[c] || new Set()).add(Number(s.module));
  }
  return out;
}

// Refresh knowledge: missed questions from every course, the ones due first (oldest first), then
// the rest still being learnt. bank: Map qid → { q, course, module }. Written answers are left out,
// so a set takes a couple of minutes.
export function pickRefresh(state, bank, today, count = REFRESH_SIZE) {
  const srs = state.srs || {};
  const active = Object.keys(srs)
    .filter(qid => srs[qid].due !== RETIRED && bank.has(qid) && bank.get(qid).q.type !== 'explain')
    .sort((a, b) => (srs[a].due < srs[b].due ? -1 : srs[a].due > srs[b].due ? 1 : (srs[b].misses || 0) - (srs[a].misses || 0)));
  const due = active.filter(qid => srs[qid].due <= today);
  const chosen = [], groups = new Set();
  for (const qid of active) {
    const b = bank.get(qid);
    const g = `${b.course}|${b.q.group || qid}`;
    if (chosen.length < count && !groups.has(g)) { chosen.push(b); groups.add(g); }
  }
  return { questions: chosen, due: due.length, waiting: active.length };
}

// Weakest spots in one course: modules tried but not passed yet (lowest best first), and the topics
// missed in the latest attempt at each quiz or checkpoint.
export function weakSpots(state, course, key, st, { limit = 5 } = {}) {
  const byKey = new Map(course.items.map(i => [key(i.id), i]));
  const latest = new Map();
  for (const a of state.attempts || []) {
    if (a.kind === 'recall' || !byKey.has(a.id)) continue;
    const cur = latest.get(a.id);
    if (!cur || Date.parse(a.at) >= Date.parse(cur.at)) latest.set(a.id, a);
  }
  const modules = course.items
    .filter(i => i.kind !== 'intro' && st[i.id] && st[i.id].state === 'open' && st[i.id].best != null)
    .map(i => ({ item: i, best: st[i.id].best }))
    .sort((a, b) => a.best - b.best);
  const best = id => (st[id] && st[id].best != null ? st[id].best : 101);
  const topics = [], seen = new Set();
  for (const a of [...latest.values()].sort((x, y) => best(byKey.get(x.id).id) - best(byKey.get(y.id).id))) {
    for (const t of a.missed || []) {
      if (seen.has(t) || topics.length >= limit) continue;
      seen.add(t);
      topics.push({ topic: t, item: byKey.get(a.id) });
    }
  }
  return { modules, topics };
}

// Whole days from today to date (both 'YYYY-MM-DD'); negative once it has passed.
export function daysUntil(date, today) {
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 864e5);
}

// Exams still to come (today counts), soonest first, each with its days left.
export function upcoming(exams, today) {
  return exams.map(e => ({ ...e, days: daysUntil(e.date, today) })).filter(e => e.days >= 0).sort((a, b) => a.days - b.days);
}

// This week's plan before an exam: how often, then refresh, retakes, topics and the next new module.
export function weekPlan({ days, refresh = 0, weak = { modules: [], topics: [] }, next = null }) {
  const weeks = Math.max(1, Math.ceil(days / 7));
  const pace = days <= 7 ? 'A short session every day until the exam.'
    : days <= 28 ? 'Five short sessions this week.'
    : 'Three or four sessions this week.';
  const steps = [];
  if (refresh) steps.push({ kind: 'refresh', count: refresh });
  for (const m of weak.modules.slice(0, 2)) steps.push({ kind: 'retake', item: m.item, best: m.best });
  if (weak.topics.length) steps.push({ kind: 'topics', topics: weak.topics.slice(0, 3) });
  if (next && !weak.modules.some(m => m.item === next)) steps.push({ kind: 'next', item: next });
  return { weeks, pace, steps };
}
