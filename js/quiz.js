// Quiz engine: builds attempts from a question pool and marks answers.
// Pure (no DOM). The page side lives in quizui.js.
import { markExplain, parseNumber } from './marking.js';

export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const gbp = (n, dp) => '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });

export function formatValue(value, fmt, dp) {
  switch (fmt) {
    case 'money0': return gbp(value, Number.isInteger(value) ? 0 : 2);
    case 'money2': return gbp(value, 2);
    case 'pct': return `${+value.toFixed(2)}%`;
    default: return dp === undefined ? String(+Number(value).toFixed(2)) : Number(value).toFixed(dp);
  }
}

export function evaluate(expr, vars) {
  const names = Object.keys(vars);
  // Content is our own (content/quizzes), never user input.
  return Function(...names, `"use strict"; return (${expr});`)(...names.map(n => vars[n]));
}

function pickVar(spec, rng, randomise) {
  if (!randomise) return spec.default;
  if (spec.choices) return spec.choices[Math.floor(rng() * spec.choices.length)];
  const steps = Math.round((spec.max - spec.min) / spec.step);
  return +(spec.min + Math.floor(rng() * (steps + 1)) * spec.step).toFixed(6);
}

function fill(text, values) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));
}

function answerText(q) {
  if (q.type === 'number') return q.unit === '£' ? formatValue(q.answerValue, 'money2') : `${formatValue(q.answerValue, null, q.dp)}${q.unit ? (q.unit === '%' ? '%' : ' ' + q.unit) : ''}`;
  if (q.type === 'mcq') return q.options[q.answer];
  if (q.type === 'tf') return q.answer ? 'True' : 'False';
  if (q.type === 'order') return q.items.join(' → ');
  if (q.type === 'match') return q.pairs.map(([l, r]) => `${l}: ${r}`).join(' · ');
  if (q.type === 'explain') return q.model;
  return '';
}

// Turns a question from the pool into one concrete instance.
// randomise=false gives the default numbers and order (first attempt, quick checks).
export function instantiate(src, { rng = Math.random, randomise = false } = {}) {
  const q = { ...src };
  const shown = {};
  if (src.type === 'number') {
    const vals = {};
    for (const [name, spec] of Object.entries(src.vars || {})) {
      vals[name] = pickVar(spec, rng, randomise);
      shown[name] = formatValue(vals[name], spec.fmt);
    }
    q.answerValue = evaluate(src.answer, vals);
    for (const [name, expr] of Object.entries(src.calc || {})) {
      shown[name] = formatValue(evaluate(expr, vals), (src.calcFmt || {})[name], src.dp);
    }
    q.values = vals;
    shown.answer = src.unit === '£' ? formatValue(q.answerValue, 'money2') : formatValue(q.answerValue, null, src.dp);
  }
  if (src.type === 'mcq' && randomise && !src.keepOrder) {
    const order = shuffle(src.options.map((_, i) => i), rng);
    q.options = order.map(i => src.options[i]);
    q.answer = order.indexOf(src.answer);
  }
  if (src.type === 'order') q.shown = shuffleUntilDifferent(src.items, rng);
  if (src.type === 'match') q.rightShown = shuffle(src.pairs.map(p => p[1]), rng);
  if (src.type === 'explain') q.marks = src.ideas.length;
  q.marks = q.marks || src.marks || 1;
  q.text = fill(src.q, shown);
  q.whyText = fill(src.why, shown);
  q.correctText = answerText(q);
  return q;
}

function shuffleUntilDifferent(items, rng) {
  for (let i = 0; i < 10; i++) {
    const s = shuffle(items, rng);
    if (s.some((x, k) => x !== items[k])) return s;
  }
  return [...items].reverse();
}

// response shapes: mcq -> index, tf -> boolean, number -> string,
// order -> array of items, match -> { left: right }, explain -> string
export function mark(q, response) {
  let marks = 0, detail = null;
  switch (q.type) {
    case 'mcq': marks = response === q.answer ? 1 : 0; break;
    case 'tf': marks = response === q.answer ? 1 : 0; break;
    case 'number': {
      const n = parseNumber(response);
      marks = Number.isFinite(n) && Math.abs(n - q.answerValue) <= (q.tol ?? 0.01) + 1e-9 ? 1 : 0;
      break;
    }
    case 'order': marks = Array.isArray(response) && response.every((x, i) => x === q.items[i]) ? 1 : 0; break;
    case 'match': {
      const right = q.pairs.map(([l, r]) => (response || {})[l] === r);
      detail = right;
      marks = right.every(Boolean) ? 1 : 0;
      break;
    }
    case 'explain': {
      const r = markExplain(response, q.ideas);
      detail = r.found;
      marks = r.marks;
      break;
    }
  }
  return { marks, outOf: q.marks, correct: marks === q.marks, detail };
}

// One random question per group, then `pick` of those, shuffled.
export function buildAttempt(pool, pick, { rng = Math.random, randomise = false } = {}) {
  const groups = new Map();
  for (const q of pool) {
    const key = q.group || q.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }
  let chosen = [...groups.values()].map(g => (randomise ? g[Math.floor(rng() * g.length)] : g[0]));
  if (randomise) chosen = shuffle(chosen, rng);
  chosen = chosen.slice(0, pick || chosen.length);
  return chosen.map(q => instantiate(q, { rng, randomise }));
}

// Checkpoint: `size` questions from the covered modules, `recentShare` of them from the latest 8.
export function buildCheckpoint(poolsByModule, covers, { size = 18, recentShare = 0.6, rng = Math.random } = {}) {
  const [from, to] = covers;
  const recentFrom = Math.max(from, to - 7);
  const recent = [], earlier = [];
  for (const [num, pool] of Object.entries(poolsByModule)) {
    const n = Number(num);
    if (n < from || n > to) continue;
    const singles = buildAttempt(pool, 0, { rng, randomise: true }).map(q => ({ ...q, module: n }));
    (n >= recentFrom ? recent : earlier).push(...singles);
  }
  const wantRecent = earlier.length ? Math.round(size * recentShare) : size;
  const a = shuffle(recent, rng).slice(0, wantRecent);
  const b = shuffle(earlier, rng).slice(0, size - a.length);
  const extra = shuffle(recent, rng).filter(q => !a.includes(q)).slice(0, size - a.length - b.length);
  return shuffle([...a, ...b, ...extra], rng);
}

export function score(results, passMark = 0.6) {
  const auto = results.reduce((s, r) => s + r.marks, 0);
  const claimed = results.reduce((s, r) => s + (r.claimed || 0), 0);
  const outOf = results.reduce((s, r) => s + r.outOf, 0);
  return verdict(auto, claimed, outOf, passMark);
}

// Several parts marked as one (a module's recall check + its quiz): raw marks pooled, same rules as score().
export function combineScores(parts, passMark = 0.6) {
  const sum = k => parts.reduce((s, p) => s + (p ? p[k] || 0 : 0), 0);
  return verdict(sum('auto'), sum('claimed'), sum('outOf'), passMark);
}

function verdict(auto, claimed, outOf, passMark) {
  const pct = outOf ? (auto + claimed) / outOf : 0;
  return { auto, claimed, outOf, pct, passed: pct >= passMark - 1e-9, autoPassed: outOf ? auto / outOf >= passMark - 1e-9 : false };
}
