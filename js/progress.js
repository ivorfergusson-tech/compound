// Learner progress: stored in this browser, synced to the account by sync.js.
// XP, levels, streaks and locks are all worked out from the stored facts, never stored themselves.
import { shuffle } from './quiz.js';

export const XP_RULES = {
  read: 20,            // finish reading a module (or the intro)
  perMark: 10,         // per auto-marked mark, best attempt of each quiz or checkpoint
  firstPassModule: 50, // first pass of a module quiz on auto-marked marks
  firstPassCheckpoint: 150,
  perRecall: 5,        // per right answer, first recall check of each module each day
  perDay: 10,          // each day you do something
  streakWeek: 50,      // every 7 days in a row
};
const SRS_GAPS = [1, 3, 7, 21]; // days until a missed question comes back, by box
const RETIRED = '9999-12-31';

function newId() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

// Joins two progress states (this browser + the account) without losing anything.
export function mergeStates(a, b) {
  const later = (x, y, key) => (!x ? y : !y ? x : (x[key] || '') >= (y[key] || '') ? x : y);
  const out = emptyState();
  out.nickname = b.nickname || a.nickname;
  for (const s of [a, b]) {
    for (const [id, t] of Object.entries(s.read || {})) out.read[id] = out.read[id] && out.read[id] < t ? out.read[id] : t;
    for (const [k, v] of Object.entries(s.guesses || {})) if (!(k in out.guesses)) out.guesses[k] = v;
    for (const [k, v] of Object.entries(s.notes || {})) out.notes[k] = later(out.notes[k], v, 'at');
    for (const [k, v] of Object.entries(s.srs || {})) out.srs[k] = later(out.srs[k], v, 'at');
  }
  const seen = new Set();
  for (const at of [...(a.attempts || []), ...(b.attempts || [])]) {
    const key = at.uid || `${at.id}|${at.at}`;
    if (!seen.has(key)) { seen.add(key); out.attempts.push(at); }
  }
  out.attempts.sort((x, y) => (x.at < y.at ? -1 : 1));
  out.days = [...new Set([...(a.days || []), ...(b.days || [])])].sort();
  return out;
}

const KEY = 'compound.progress.v1';

export function emptyState() {
  return { v: 1, nickname: null, read: {}, attempts: [], srs: {}, notes: {}, guesses: {}, days: [] };
}

export function localDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return localDate(d);
}

export class Progress {
  constructor({ storage = globalThis.localStorage, today = () => localDate() } = {}) {
    this.storage = storage;
    this.today = today;
    this.listeners = new Set();
    this.state = this.load();
  }

  load() {
    try {
      const raw = this.storage && this.storage.getItem(KEY);
      if (raw) return { ...emptyState(), ...JSON.parse(raw) };
    } catch { /* private mode or bad data: start fresh */ }
    return emptyState();
  }

  save() {
    try { this.storage && this.storage.setItem(KEY, JSON.stringify(this.state)); } catch { /* storage blocked */ }
    for (const fn of this.listeners) fn(this.state);
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  replace(state) { this.state = { ...emptyState(), ...state }; this.save(); }

  // Admin preview: start blank and keep everything in memory, so this browser's saved progress is left alone.
  preview() { this.storage = null; this.replace(emptyState()); }

  touchDay() {
    const t = this.today();
    if (!this.state.days.includes(t)) this.state.days.push(t);
  }

  markRead(id) {
    if (this.state.read[id]) return false;
    this.state.read[id] = new Date().toISOString();
    this.touchDay();
    this.save();
    return true;
  }

  saveNote(id, text) {
    this.state.notes[id] = { text, at: new Date().toISOString() };
    this.save();
  }

  saveGuess(key, value) {
    this.state.guesses[key] = value;
    this.save();
  }

  setNickname(name) { this.state.nickname = name; this.save(); }

  // a: { kind: 'quiz'|'checkpoint'|'recall', id, module?, auto, claimed, outOf, passed, autoPassed,
  //      results: [{ qid, module, topic, correct }] }
  recordAttempt(a) {
    const today = this.today();
    const missed = [...new Set(a.results.filter(r => !r.correct).map(r => r.topic).filter(Boolean))];
    const attempt = {
      uid: newId(), at: new Date().toISOString(), day: today, kind: a.kind, id: a.id,
      auto: a.auto, claimed: a.claimed || 0, outOf: a.outOf,
      passed: Boolean(a.passed), autoPassed: Boolean(a.autoPassed), missed,
      wrong: a.results.filter(r => !r.correct).map(r => r.qid),
      right: a.results.filter(r => r.correct).map(r => r.qid),
    };
    this.state.attempts.push(attempt);
    const at = attempt.at;
    for (const r of a.results) {
      const s = this.state.srs[r.qid];
      if (!r.correct) {
        this.state.srs[r.qid] = { box: 0, due: today, module: r.module, misses: (s ? s.misses : 0) + 1, at };
      } else if (s && s.due !== RETIRED) {
        const box = s.box + 1;
        // Kept (not deleted) once learnt, so sync never brings it back.
        const due = box > SRS_GAPS.length ? RETIRED : addDays(today, SRS_GAPS[box - 1]);
        this.state.srs[r.qid] = { ...s, box, due, at };
      }
    }
    this.touchDay();
    this.save();
    return attempt;
  }

  attemptsFor(id) { return this.state.attempts.filter(a => a.id === id && a.kind !== 'recall'); }

  best(id) {
    const list = this.attemptsFor(id);
    if (!list.length) return null;
    return list.reduce((b, a) => ((a.auto + a.claimed) / a.outOf > (b.auto + b.claimed) / b.outOf ? a : b));
  }

  passed(id) { return this.attemptsFor(id).some(a => a.passed); }

  // Streak: days in a row up to today (or yesterday, so it doesn't vanish at midnight).
  streak() {
    const days = new Set(this.state.days);
    let d = this.today();
    if (!days.has(d)) d = addDays(d, -1);
    let n = 0;
    while (days.has(d)) { n++; d = addDays(d, -1); }
    return n;
  }

  xp() { return xpFromState(this.state); }
}

export function xpFromState(state) {
  const R = XP_RULES;
  const parts = { reading: 0, marks: 0, passes: 0, recall: 0, days: 0, streaks: 0 };
  parts.reading = Object.keys(state.read).length * R.read;

  const byId = new Map();
  for (const a of state.attempts) {
    if (a.kind === 'recall') continue;
    const cur = byId.get(a.id) || { bestAuto: 0, autoPassed: false, kind: a.kind };
    cur.bestAuto = Math.max(cur.bestAuto, a.auto);
    cur.autoPassed = cur.autoPassed || a.autoPassed;
    byId.set(a.id, cur);
  }
  for (const v of byId.values()) {
    parts.marks += v.bestAuto * R.perMark;
    if (v.autoPassed) parts.passes += v.kind === 'checkpoint' ? R.firstPassCheckpoint : R.firstPassModule;
  }

  const recallSeen = new Set();
  for (const a of state.attempts) {
    if (a.kind !== 'recall') continue;
    const key = `${a.id}|${a.day}`;
    if (recallSeen.has(key)) continue;
    recallSeen.add(key);
    parts.recall += a.auto * R.perRecall;
  }

  const days = [...new Set(state.days)].sort();
  parts.days = days.length * R.perDay;
  let run = 0, prev = null;
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    if (run % 7 === 0) parts.streaks += R.streakWeek;
    prev = d;
  }
  const total = Object.values(parts).reduce((s, n) => s + n, 0);
  return { total, parts };
}

// Level L starts at 50·L·(L−1) XP: 0, 100, 300, 600, 1000, 1500…
export function levelFor(xp) {
  let L = 1;
  while (50 * (L + 1) * L <= xp) L++;
  const from = 50 * L * (L - 1), to = 50 * (L + 1) * L;
  return { level: L, from, to, into: xp - from, need: to - from };
}

// Status of every item on the course map.
export function courseStatus(items, progress, ready, { unlockAll = false } = {}) {
  const out = {};
  let gate = null;
  for (const item of items) {
    if (item.kind === 'intro') {
      out[item.id] = { state: progress.state.read[item.id] ? 'done' : 'open' };
      continue;
    }
    const unlocked = unlockAll || !gate || progress.passed(gate.id);
    const best = progress.best(item.id);
    let s;
    if (!unlocked) {
      s = { state: 'locked', reason: gate.kind === 'checkpoint' ? `Pass ${gate.title.toLowerCase()} to unlock` : `Pass module ${gate.num}'s quiz to unlock` };
    } else if (!ready.includes(item.id)) {
      s = { state: 'soon', reason: 'Coming soon' };
    } else if (progress.passed(item.id)) {
      s = { state: 'passed' };
    } else {
      s = { state: 'open' };
    }
    s.best = best ? Math.round(((best.auto + best.claimed) / best.outOf) * 100) : null;
    out[item.id] = s;
    gate = item;
  }
  return out;
}

// Recall check: missed questions that are due come first (oldest first), then random earlier ones.
export function pickRecall(progress, poolsByNum, beforeNum, count = 4, rng = Math.random) {
  const quick = q => q.type !== 'explain';
  const all = [];
  for (const [num, pool] of Object.entries(poolsByNum)) {
    if (Number(num) < beforeNum) for (const q of pool) if (quick(q)) all.push({ ...q, module: Number(num) });
  }
  const today = progress.today();
  const srs = progress.state.srs;
  const due = all.filter(q => srs[q.id] && srs[q.id].due <= today).sort((a, b) => (srs[a.id].due < srs[b.id].due ? -1 : 1));
  const chosen = [];
  const groupsUsed = new Set();
  const add = q => {
    const g = q.group || q.id;
    if (chosen.length < count && !groupsUsed.has(g)) { chosen.push(q); groupsUsed.add(g); }
  };
  due.forEach(add);
  shuffle(all, rng).forEach(add);
  return chosen;
}
