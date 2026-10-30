// My exams: dates a learner adds themselves (mocks, the real exams) for the dashboard countdown.
// Saved in this browser (compound.exams) and, when signed in, to the account (settings.exams, sync.js).
// The newer copy wins, like the display settings.
const KEY = 'compound.exams';
export const MAX_EXAMS = 12;
export const MAX_NAME = 60;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9-]{1,40}$/;
const COURSE = /^[a-z0-9-]{2,30}$/;

const validDate = s => typeof s === 'string' && DATE.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`))
  && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;

// Only well-formed exams survive (the list also comes back from the account), soonest first.
export function cleanList(list) {
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    if (!e || typeof e !== 'object' || out.length >= MAX_EXAMS) continue;
    const name = typeof e.name === 'string' ? e.name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '';
    if (!name || !validDate(e.date)) continue;
    const id = typeof e.id === 'string' && ID.test(e.id) ? e.id : `e${out.length}-${e.date}`;
    out.push({ id, name, date: e.date, ...(typeof e.course === 'string' && COURSE.test(e.course) ? { course: e.course } : {}) });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function clean(d) {
  return { list: cleanList(d && d.list), updatedAt: (d && typeof d.updatedAt === 'string' && d.updatedAt) || '' };
}

export function load(storage = globalThis.localStorage) {
  try { return clean(JSON.parse(storage.getItem(KEY) || 'null')); } catch { return clean(null); }
}

export function save(d, storage = globalThis.localStorage) {
  const c = clean(d);
  try { storage.setItem(KEY, JSON.stringify(c)); } catch { /* blocked */ }
  return c;
}

// The newer of this browser's exams and the account's.
export function newer(a, b) { return (b && b.updatedAt || '') > (a && a.updatedAt || '') ? clean(b) : clean(a); }

export function newId() { return `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; }

let current = null;
const listeners = new Set();
export function get() { return current || (current = load()); }
export function onChange(fn) { listeners.add(fn); }
// set(list) from the dashboard form; set(remote, { fromAccount: true }) when the account's copy is newer.
export function set(next, { fromAccount = false } = {}) {
  current = save(fromAccount ? next : { list: next, updatedAt: new Date().toISOString() });
  if (!fromAccount) for (const fn of listeners) fn(current);
  return current;
}
