// Run: node tests/run.js
// Checks marking, the quiz engine, XP, locks and recall. Explain questions in every quiz file
// can carry "tests": [{ "answer": "...", "marks": n }] and are all checked here.
import { readFileSync, readdirSync } from 'node:fs';
import { markExplain, parseNumber } from '../js/marking.js';
import { instantiate, mark, buildAttempt, buildCheckpoint, score, seededRng } from '../js/quiz.js';
import { Progress, xpFromState, levelFor, courseStatus, pickRecall, mergeStates, emptyState } from '../js/progress.js';
import { nicknameProblem } from '../js/nickname.js';
import { payslip } from '../js/calcs-money.js';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

const root = new URL('../content/', import.meta.url);
const course = JSON.parse(readFileSync(new URL('course.json', root)));
const quizzes = {};
for (const f of readdirSync(new URL('quizzes/', root))) {
  const qz = JSON.parse(readFileSync(new URL(`quizzes/${f}`, root)));
  quizzes[qz.module] = qz;
}

// --- number parsing
check('parse £', parseNumber('£926.10') === 926.1);
check('parse commas', parseNumber('1,234.5') === 1234.5);
check('parse minus sign', parseNumber('−3.4%') === -3.4);
check('parse words', parseNumber('about 12 years') === 12);
check('parse blank', Number.isNaN(parseNumber('')));

// --- every explain question: its test answers (right, half right, wrong) get the expected marks
for (const qz of Object.values(quizzes)) {
  for (const q of qz.questions) {
    if (q.type !== 'explain') continue;
    check(`${q.id} has 3 tests`, (q.tests || []).length >= 3);
    for (const t of q.tests || []) {
      const r = markExplain(t.answer, q.ideas);
      check(`${q.id}: "${t.answer.slice(0, 50)}"`, r.marks === t.marks, `got ${r.marks}, want ${t.marks}`);
    }
  }
}
// typos, case and negation
const ideas = [{ label: 'spending power', any: ['spending power', 'buys less'] }];
check('typo tolerant', markExplain('It looses SPENDNG POWER', ideas).marks === 1);
check('negation', markExplain('it does not buys less', ideas).marks === 0);

// --- every question in every pool instantiates and marks its own right answer as correct
const rng = seededRng(42);
for (const qz of Object.values(quizzes)) {
  for (const src of qz.questions) {
    for (const randomise of [false, true]) {
      const q = instantiate(src, { rng, randomise });
      const right = {
        mcq: q.answer, tf: q.answer, number: String(q.answerValue), order: q.items,
        match: Object.fromEntries((q.pairs || []).map(([l, r]) => [l, r])), explain: q.model,
      }[q.type];
      const m = mark(q, right);
      check(`${src.id} right answer correct (randomise=${randomise})`, m.correct, JSON.stringify(m));
      check(`${src.id} text filled`, !/\{\w+\}/.test(q.text + q.whyText), q.text);
    }
  }
}

// --- number tolerance: £926.10 ± £0.50
const cb = instantiate(quizzes['01'].questions.find(q => q.id === '01-compound-balance'));
check('926.10 right', mark(cb, '926.10').correct);
check('926.55 within tol', mark(cb, '£926.55').correct);
check('927 outside tol', !mark(cb, '927').correct);
const ioi = instantiate(quizzes['01'].questions.find(q => q.id === '01-interest-on-interest'));
check('interest on interest is £6.10', Math.abs(ioi.answerValue - 6.1) < 0.001);
check('next year\'s interest is wrong', !mark(ioi, '46.31').correct);

// --- attempts: size, groups, reshuffle
const a1 = buildAttempt(quizzes['01'].questions, quizzes['01'].pick);
check('attempt size', a1.length === quizzes['01'].pick);
const groups = a1.map(q => q.group).filter(Boolean);
check('one per group', new Set(groups).size === groups.length);
const a2 = buildAttempt(quizzes['01'].questions, quizzes['01'].pick, { rng: seededRng(7), randomise: true });
check('retry reshuffles', a2.map(q => q.id).join() !== a1.map(q => q.id).join());

// --- scoring and claims
const s = score([{ marks: 1, outOf: 1 }, { marks: 1, outOf: 2, claimed: 1 }, { marks: 2, outOf: 2 }, { marks: 0, outOf: 1 }]);
check('score with claim', s.auto === 4 && s.claimed === 1 && s.outOf === 6 && s.passed && s.autoPassed);
const s2 = score([{ marks: 1, outOf: 2, claimed: 1 }, { marks: 1, outOf: 3 }]);
check('claim passes but not auto-pass', s2.passed && !s2.autoPassed);

// --- XP: claimed marks never count
function mem() { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; }
const p = new Progress({ storage: mem(), today: () => '2026-10-27' });
const results = n => Array.from({ length: n }, (_, i) => ({ qid: `q${i}`, module: 1, topic: `t${i}`, correct: true }));
p.recordAttempt({ kind: 'quiz', id: '01', auto: 4, claimed: 0, outOf: 7, passed: false, autoPassed: false, results: results(7).map((r, i) => ({ ...r, correct: i < 4 })) });
const xpBefore = p.xp().total;
const p2 = new Progress({ storage: mem(), today: () => '2026-10-27' });
p2.recordAttempt({ kind: 'quiz', id: '01', auto: 4, claimed: 1, outOf: 7, passed: true, autoPassed: false, results: results(7).map((r, i) => ({ ...r, correct: i < 4 })) });
check('claims add no XP', p2.xp().total === xpBefore, `${p2.xp().total} vs ${xpBefore}`);
check('claim still unlocks', p2.passed('01'));

// --- locks
const ready = ['00', '01', '02'];
let st = courseStatus(course.items, p, ready);
check('module 1 open', st['01'].state === 'open');
check('module 2 locked after 57%', st['02'].state === 'locked' && /module 1/.test(st['02'].reason));
p.recordAttempt({ kind: 'quiz', id: '01', auto: 5, claimed: 0, outOf: 7, passed: true, autoPassed: true, results: results(7) });
st = courseStatus(course.items, p, ready);
check('module 2 open after pass', st['02'].state === 'open');
check('module 3 still locked', st['03'].state === 'locked');
check('best attempt counts', st['01'].best === 71);
const pc = new Progress({ storage: mem() });
for (let n = 1; n <= 8; n++) pc.recordAttempt({ kind: 'quiz', id: String(n).padStart(2, '0'), auto: 6, outOf: 7, passed: true, autoPassed: true, results: [] });
const stc = courseStatus(course.items, pc, course.items.map(i => i.id));
check('checkpoint 1 open after module 8', stc.cp1.state === 'open');
check('module 9 waits for checkpoint', stc['09'].state === 'locked' && /checkpoint/.test(stc['09'].reason));

// --- XP sums and levels
const x = xpFromState({ read: { '00': 1, '01': 1 }, attempts: [], days: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'] });
check('XP read + days + week streak', x.total === 40 + 70 + 50, JSON.stringify(x));
check('levels', levelFor(0).level === 1 && levelFor(99).level === 1 && levelFor(100).level === 2 && levelFor(300).level === 3);

// --- recall: missed questions come back first
const pr = new Progress({ storage: mem(), today: () => '2026-10-27' });
pr.recordAttempt({ kind: 'quiz', id: '01', auto: 0, outOf: 1, results: [{ qid: '01-rule-72', module: 1, topic: 'rule of 72', correct: false }] });
const rc = pickRecall(pr, { 1: quizzes['01'].questions }, 2, 4, seededRng(1));
check('recall size', rc.length === 4);
check('missed first', rc[0].id === '01-rule-72');
check('no explain in recall', rc.every(q => q.type !== 'explain'));
pr.recordAttempt({ kind: 'recall', id: '02', auto: 1, outOf: 1, results: [{ qid: '01-rule-72', module: 1, correct: true }] });
check('right answer pushes it back', pr.state.srs['01-rule-72'].due === '2026-10-28');

// --- checkpoint builder weights the latest 8
const pools = { 1: quizzes['01'].questions };
const cp = buildCheckpoint(pools, [1, 8], { size: 5, rng: seededRng(3) });
check('checkpoint builds', cp.length === 5);

// --- content integrity
const glossary = JSON.parse(readFileSync(new URL('glossary.json', root)));
const figures = JSON.parse(readFileSync(new URL('figures.json', root))).figures;
for (const f of readdirSync(new URL('modules/', root))) {
  const md = readFileSync(new URL(`modules/${f}`, root), 'utf8');
  for (const [, key] of md.matchAll(/\[\[([^\]|]+)/g)) check(`${f}: glossary has "${key}"`, key.toLowerCase() in glossary);
  for (const [, key] of md.matchAll(/\{\{fig:(\w+)\+?\}\}/g)) check(`${f}: figure ${key}`, key in figures);
}
for (const [k, f] of Object.entries(figures)) check(`figure ${k} has source and date`, f.source && f.url && /^\d{4}-\d{2}-\d{2}$/.test(f.checked));
for (const [k, g] of Object.entries(glossary)) check(`glossary ${k} module exists`, course.items.some(i => i.id === g.module));

// --- merging this browser with the account
const local = { ...emptyState(), read: { '01': '2026-10-27T10:00:00Z' }, attempts: [{ uid: 'a', id: '01', at: '2026-10-27T11:00:00Z' }], notes: { '01': { text: 'new', at: '2026-10-27T12:00:00Z' } }, days: ['2026-10-27'] };
const remote = { ...emptyState(), nickname: 'saver', read: { '00': '2026-10-26T10:00:00Z', '01': '2026-10-26T10:00:00Z' }, attempts: [{ uid: 'a', id: '01', at: '2026-10-27T11:00:00Z' }, { uid: 'b', id: '01', at: '2026-10-26T11:00:00Z' }], notes: { '01': { text: 'old', at: '2026-10-26T12:00:00Z' } }, days: ['2026-10-26'] };
const mg = mergeStates(local, remote);
check('merge keeps both reads, earliest time', Object.keys(mg.read).length === 2 && mg.read['01'] === '2026-10-26T10:00:00Z');
check('merge dedupes attempts', mg.attempts.length === 2);
check('merge keeps newest note', mg.notes['01'].text === 'new');
check('merge days and nickname', mg.days.length === 2 && mg.nickname === 'saver');

// --- nicknames
for (const ok of ['Essex_lad', 'Dickens fan', 'grapefruit', 'Scunthorpe', 'money-wise 99']) check(`nickname ok: ${ok}`, nicknameProblem(ok) === null);
for (const bad of ['ab', 'f.u.c.k', 'sh1tlord', 'big sex', 'a'.repeat(21), 'emoji😀']) check(`nickname blocked: ${bad}`, nicknameProblem(bad) !== null);

// --- take-home pay matches hand-worked 2026/27 figures
const near = (a, b) => Math.abs(a - b) < 0.02;
const ps = (o) => payslip(figures, o);
let r = ps({ salary: 25000 });
check('payslip £25k England', near(r.tax, 2486) && near(r.ni, 994.4) && near(r.net, 21519.6), JSON.stringify(r));
r = ps({ salary: 25000, region: 'scot' });
check('payslip £25k Scotland', near(r.tax, 2446.33), JSON.stringify(r));
r = ps({ salary: 25000, pensionPct: 5 });
check('payslip £25k with 5% pension', near(r.pension, 938) && near(r.tax, 2298.4) && near(r.net, 20769.2), JSON.stringify(r));
r = ps({ salary: 30000, plan: 'plan5', pensionPct: 5 });
check('payslip £30k Plan 5', near(r.loan, 450) && near(r.net, 23719.2), JSON.stringify(r));
r = ps({ salary: 60000 });
check('payslip £60k higher rate', near(r.tax, 11432) && near(r.ni, 3210.6), JSON.stringify(r));
r = ps({ salary: 110000 });
check('payslip £110k allowance taper', near(r.pa, 7570), JSON.stringify(r));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
