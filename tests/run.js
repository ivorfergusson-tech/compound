// Run: node tests/run.js
// Checks marking, the quiz engine, XP, locks, recall, the course registry and progress keys. Explain questions in every quiz file
// can carry "tests": [{ "answer": "...", "marks": n }] and are all checked here.
import { readFileSync, readdirSync } from 'node:fs';
import { markExplain, parseNumber } from '../js/marking.js';
import { instantiate, mark, buildAttempt, buildCheckpoint, score, combineScores, seededRng } from '../js/quiz.js';
import { Progress, xpFromState, levelFor, courseStatus, pickRecall, mergeStates, emptyState, itemKey, attemptPct } from '../js/progress.js';
import { nicknameProblem, nicknameLock, lockMessage, passwordProblem } from '../js/nickname.js';
import { clean as cleanDisplay, newer as newerDisplay, load as loadDisplay, save as saveDisplay, DEFAULTS as DISPLAY_DEFAULTS } from '../js/display.js';
import { payslip } from '../js/calcs-money.js';
import { sma, rsi, streakChance, tradeStats, makeCandles } from '../js/calcs-trade.js';
import { mortgagePayment, bondPrice, lbo, optionPnl } from '../js/calcs-industry.js';
import { build } from '../tools/build_pages.mjs';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

const contentRoot = new URL('../content/', import.meta.url);
const registry = JSON.parse(readFileSync(new URL('courses.json', contentRoot)));
const root = new URL('courses/money/', contentRoot);
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
check('prefix *', markExplain('growth accelerates later', [{ label: 'x', any: ['accelerat*'] }]).marks === 1);

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

// --- admin preview: everything unlocked, nothing written to storage
const allIds = course.items.map(i => i.id);
const sta = courseStatus(course.items, new Progress({ storage: mem() }), allIds, { unlockAll: true });
check('admin preview unlocks every item', Object.values(sta).every(v => v.state === 'open'));
const store = mem();
const pv = new Progress({ storage: store });
pv.recordAttempt({ kind: 'quiz', id: '01', auto: 7, outOf: 7, passed: true, autoPassed: true, results: [] });
const savedBefore = store.getItem('compound.progress.v1');
pv.preview();
check('preview starts blank', pv.state.attempts.length === 0);
pv.recordAttempt({ kind: 'quiz', id: '02', auto: 7, outOf: 7, passed: true, autoPassed: true, results: [] });
pv.markRead('03');
check('preview leaves saved progress alone', store.getItem('compound.progress.v1') === savedBefore && JSON.parse(savedBefore).attempts.length === 1);

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
const figures = JSON.parse(readFileSync(new URL('figures.json', contentRoot))).figures;
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

// --- course registry: every live course has its folder, and its course.json says who it is
const BOARDS = ['aqa', 'edexcel', 'ocr', 'wjec', 'cie'];
const REVIEW = ['ai-draft', 'reviewed-by-owner', 'reviewed-by-teacher'];
check('registry default is a live course', registry.courses.some(c => c.id === registry.default && c.live));
check('registry ids unique', new Set(registry.courses.map(c => c.id)).size === registry.courses.length);
for (const e of registry.courses) {
  check(`${e.id}: subject listed`, e.subject in registry.subjects);
  check(`${e.id}: board known`, e.board === null || BOARDS.includes(e.board));
  check(`${e.id}: path is content/courses/<id>/`, e.path === `content/courses/${e.id}/`);
  if (!e.live) continue;
  const c = JSON.parse(readFileSync(new URL(`courses/${e.id}/course.json`, contentRoot)));
  check(`${e.id}: course.json id matches`, c.id === e.id);
  check(`${e.id}: board, spec, specVersion fields`, 'board' in c && 'spec' in c && 'specVersion' in c && c.board === e.board);
  check(`${e.id}: A-level course names its spec and version`, c.board === null || (c.spec && c.specVersion));
  check(`${e.id}: only Money keeps bare ids`, Boolean(c.legacyIds) === (e.id === 'money'));
  check(`${e.id}: pass mark`, c.passMark > 0 && c.passMark <= 1);
  // nothing below reviewed-by-owner reaches students
  for (const id of c.ready) {
    const item = c.items.find(i => i.id === id);
    const review = (item && item.review) || c.review || {};
    check(`${e.id}/${id}: review status known`, REVIEW.includes(review.status), review.status);
    check(`${e.id}/${id}: reviewed before it's published`, review.status !== 'ai-draft' && review.by && /^\d{4}-\d{2}-\d{2}$/.test(review.date || ''));
  }
}

// --- progress keys: Money's are unchanged, other courses are prefixed, and the database accepts both
const econ = { id: 'econ-aqa', items: [], ready: [] };
check('Money keys unchanged', itemKey(course, '01') === '01' && itemKey(course, 'cp1') === 'cp1');
check('other courses prefixed', itemKey(econ, '4.1.5') === 'econ-aqa:4.1.5');
const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const idRule = sql.match(/attempts_item_id_ok\s+check \(item_id ~ '([^']+)'\)/);
check('schema has the item id rule', Boolean(idRule));
if (idRule) {
  const re = new RegExp(idRule[1]);
  for (const k of ['00', '01', '32', 'cp1', 'cp4', 'econ-aqa:4.1.5', 'econ-aqa:4.1.5.4', 'bus-aqa:3.2']) check(`schema accepts ${k}`, re.test(k));
  for (const k of ['', 'x', 'drop table', 'econ-aqa:', ':4.1', 'ECON:1']) check(`schema rejects "${k}"`, !re.test(k));
}

// --- Money progress saved before courses existed loads and counts exactly as before
const oldStore = mem();
const oldState = { v: 1, nickname: 'saver', read: { '00': '2026-10-20T10:00:00Z', '01': '2026-10-20T10:05:00Z' }, srs: {}, notes: { '01': { text: 'mine', at: '2026-10-20T10:06:00Z' } }, guesses: {}, days: ['2026-10-20'],
  attempts: [{ uid: 'old1', at: '2026-10-20T10:10:00Z', day: '2026-10-20', kind: 'quiz', id: '01', auto: 5, claimed: 0, outOf: 7, passed: true, autoPassed: true, missed: [], wrong: [], right: [] },
             { uid: 'old2', at: '2026-10-20T10:20:00Z', day: '2026-10-20', kind: 'quiz', id: '02', auto: 3, claimed: 2, outOf: 8, passed: true, autoPassed: false, missed: [], wrong: [], right: [] }] };
oldStore.setItem('compound.progress.v1', JSON.stringify(oldState));
const po = new Progress({ storage: oldStore, today: () => '2026-10-29' });
check('old progress loads', po.state.attempts.length === 2 && po.state.notes['01'].text === 'mine' && po.state.nickname === 'saver');
check('old XP unchanged', po.xp().total === xpFromState(oldState).total);
const sto = courseStatus(course.items, po, course.items.map(i => i.id), { key: id => itemKey(course, id) });
check('old passes stay passed', sto['01'].state === 'passed' && sto['02'].state === 'passed');
check('old pass with claims kept (no recall part)', sto['02'].best === 63);
check('module after old passes is open', sto['03'].state === 'open');

// --- one progress state, courses kept apart
const pm = new Progress({ storage: mem(), today: () => '2026-10-29' });
pm.recordAttempt({ kind: 'quiz', id: '01', auto: 7, outOf: 7, passed: true, autoPassed: true, results: [] });
pm.recordAttempt({ kind: 'quiz', id: 'econ-aqa:01', auto: 0, outOf: 7, passed: false, autoPassed: false, results: [] });
check('Money pass does not pass another course', pm.passed('01') && !pm.passed('econ-aqa:01'));
const econItems = [{ id: '01', kind: 'module', num: 1 }, { id: '02', kind: 'module', num: 2 }];
const ste = courseStatus(econItems, pm, ['01', '02'], { key: id => itemKey(econ, id) });
check('other course locks follow its own progress', ste['01'].state === 'open' && ste['01'].best === 0 && ste['02'].state === 'locked');
const mgc = mergeStates(
  { ...emptyState(), read: { '01': '2026-10-29T09:00:00Z' }, attempts: [{ uid: 'm1', id: '01', at: '2026-10-29T09:00:00Z' }] },
  { ...emptyState(), read: { 'econ-aqa:01': '2026-10-29T10:00:00Z' }, attempts: [{ uid: 'e1', id: 'econ-aqa:01', at: '2026-10-29T10:00:00Z' }] });
check('merge keeps every course', mgc.read['01'] && mgc.read['econ-aqa:01'] && mgc.attempts.length === 2);

// --- the recall check counts towards the module pass
const parts = combineScores([{ auto: 1, claimed: 0, outOf: 4 }, { auto: 6, claimed: 1, outOf: 9 }], 0.6);
check('recall + quiz marks pooled', parts.auto === 7 && parts.claimed === 1 && parts.outOf === 13 && Math.abs(parts.pct - 8 / 13) < 1e-9 && parts.passed && !parts.autoPassed);
check('quiz alone would pass, weak recall pulls it under', score([{ marks: 6, outOf: 9 }]).passed && !combineScores([{ auto: 0, outOf: 4 }, { auto: 6, outOf: 9 }]).passed);
check('strong recall lifts a weak quiz', !score([{ marks: 5, outOf: 9 }]).passed && combineScores([{ auto: 4, outOf: 4 }, { auto: 5, outOf: 9 }]).passed);
check('no recall part = quiz alone (module 1)', JSON.stringify(combineScores([null, { auto: 5, claimed: 0, outOf: 7 }])) === JSON.stringify(score([{ marks: 5, outOf: 7 }])));
check('module 1 has nothing to recall', pickRecall(new Progress({ storage: mem() }), {}, 1, 4).length === 0);

const pq = new Progress({ storage: mem(), today: () => '2026-10-29' });
check('no recall check yet', pq.pendingRecall('05') === null);
pq.recordAttempt({ kind: 'recall', id: '05', auto: 3, claimed: 0, outOf: 4, results: [] });
check('recall check waits for the quiz', pq.pendingRecall('05')?.auto === 3);
check('recall for another module does not count', pq.pendingRecall('06') === null);
const before = pq.xp().parts.marks;
pq.recordAttempt({ kind: 'quiz', id: '05', auto: 4, claimed: 0, outOf: 9, passed: true, autoPassed: true, recall: { title: 'Recall check', auto: 3, claimed: 0, outOf: 4 }, results: [] });
const qa = pq.attemptsFor('05')[0];
check('quiz attempt stores the recall part', qa.recall && qa.recall.auto === 3 && qa.recall.outOf === 4 && !('title' in qa.recall));
check('combined score', Math.abs(attemptPct(qa) - 7 / 13) < 1e-9);
check('XP marks count the quiz part only', pq.xp().parts.marks - before === 4 * 10);
check('each quiz attempt needs a fresh recall check', pq.pendingRecall('05') === null);
pq.recordAttempt({ kind: 'recall', id: '05', auto: 4, claimed: 0, outOf: 4, results: [] });
pq.recordAttempt({ kind: 'quiz', id: '05', auto: 5, claimed: 0, outOf: 9, passed: true, autoPassed: true, recall: { auto: 4, claimed: 0, outOf: 4 }, results: [] });
check('best combined attempt counts', Math.abs(attemptPct(pq.best('05')) - 9 / 13) < 1e-9);
check('legacy attempt score is quiz alone', attemptPct({ auto: 3, claimed: 2, outOf: 8 }) === 5 / 8);
const pt = new Progress({ storage: mem(), today: () => '2026-10-29' });
pt.state.attempts.push({ kind: 'quiz', id: '07', at: '2026-10-29T10:00:00.000+00:00', auto: 1, outOf: 9, results: [] });
pt.state.attempts.push({ kind: 'recall', id: '07', at: '2026-10-29T09:59:00.000Z', auto: 1, outOf: 4 });
check('synced time formats compare as times', pt.pendingRecall('07') === null);

// --- nicknames
for (const ok of ['Essex_lad', 'Dickens fan', 'grapefruit', 'Scunthorpe', 'money-wise 99']) check(`nickname ok: ${ok}`, nicknameProblem(ok) === null);
for (const bad of ['ab', 'f.u.c.k', 'sh1tlord', 'big sex', 'a'.repeat(21), 'emoji😀']) check(`nickname blocked: ${bad}`, nicknameProblem(bad) !== null);

// --- nickname lock: 7 days after it's set or changed
const NOW = Date.parse('2026-10-29T12:00:00Z');
check('never set: free', !nicknameLock(null, false, NOW).locked);
const l2 = nicknameLock('2026-10-27T12:00:00Z', false, NOW);
check('changed 2 days ago: 5 days left', l2.locked && l2.daysLeft === 5, JSON.stringify(l2));
check('lock message', lockMessage(l2) === 'You can change your nickname in 5 days.');
check('one day left says day', lockMessage(nicknameLock('2026-10-22T13:00:00Z', false, NOW)) === 'You can change your nickname in 1 day.');
check('changed 7 days ago: free', !nicknameLock('2026-10-22T12:00:00Z', false, NOW).locked);
check('changed just now: 7 days', nicknameLock('2026-10-29T12:00:00Z', false, NOW + 1000).daysLeft === 7);
check('teacher reset: free to pick now', !nicknameLock('2026-10-29T11:00:00Z', true, NOW).locked);
check('schema locks nicknames in SQL', /create trigger profiles_nickname_lock/.test(sql) && /interval '7 days'/.test(sql) && /errcode = 'CN001'/.test(sql));
check('schema: forced pick keeps the lock clock', /old\.nickname_must_change then\s+new\.nickname_must_change := false;/.test(sql));
check('schema: settings table has row level security', /'active_days', 'settings'\] loop/.test(sql));

// --- passwords
for (const ok of ['correct horse', 'Tr1cky-pass', 'a'.repeat(8) + 'b']) check(`password ok: ${ok}`, passwordProblem(ok) === null);
for (const bad of ['', 'short', '1234567', 'password', 'aaaaaaaaaa', 'x'.repeat(73)]) check(`password blocked: "${bad.slice(0, 12)}"`, passwordProblem(bad) !== null);
check('password not the email', passwordProblem('me@school.uk', 'ME@school.uk') !== null);

// --- display settings
check('display defaults', JSON.stringify(cleanDisplay({})) === JSON.stringify({ ...DISPLAY_DEFAULTS, updatedAt: '' }));
check('display drops unknown values', cleanDisplay({ size: 'huge', font: 'lexend', evil: '<b>' }).size === 'm' && cleanDisplay({ font: 'lexend' }).font === 'lexend' && !('evil' in cleanDisplay({ evil: 1 })));
check('newer display wins', newerDisplay({ size: 'l', updatedAt: '2026-10-29T10:00:00Z' }, { size: 'xl', updatedAt: '2026-10-29T11:00:00Z' }).size === 'xl'
  && newerDisplay({ size: 'l', updatedAt: '2026-10-29T12:00:00Z' }, { size: 'xl', updatedAt: '2026-10-29T11:00:00Z' }).size === 'l');
const ds = mem();
ds.setItem('compound.theme', 'light');
check('old theme setting carries over', loadDisplay(ds).theme === 'light');
saveDisplay({ ...loadDisplay(ds), contrast: 'high', theme: 'dark' }, ds);
check('display saved, theme kept for reading pages', loadDisplay(ds).contrast === 'high' && ds.getItem('compound.theme') === 'dark');

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

// --- trading maths
check('sma', JSON.stringify(sma([1, 2, 3, 4], 2)) === JSON.stringify([null, 1.5, 2.5, 3.5]));
const rup = rsi(Array.from({ length: 30 }, (_, i) => 100 + i));
check('rsi of steady rise is 100', Math.round(rup[29]) === 100, rup[29]);
const rmix = rsi(Array.from({ length: 40 }, (_, i) => 100 + (i % 2 ? 1 : -1)));
check('rsi of chop is near 50', Math.abs(rmix[39] - 50) < 10, rmix[39]);
check('streak certain when all lose', Math.abs(streakChance(10, 3, 1) - 1) < 1e-9);
check('streak impossible when short', streakChance(2, 3, 0.9) === 0);
check('streak 2 in 2 coin flips = 25%', Math.abs(streakChance(2, 2, 0.5) - 0.25) < 1e-9);
const ts = tradeStats([2, -1, -1, 1.5, -1]);
check('trade stats', ts.n === 5 && Math.abs(ts.winRate - 0.4) < 1e-9 && Math.abs(ts.expectancy - 0.1) < 1e-9 && ts.longest === 2 && Math.abs(ts.maxDd - 2) < 1e-9, JSON.stringify(ts));
const mc = makeCandles();
check('candles valid', mc.length === 70 && mc.every(c => c.h >= Math.max(c.o, c.c) && c.l <= Math.min(c.o, c.c)));
check('candles range then breakout', Math.max(...mc.slice(25, 50).map(c => c.c)) < 111 && mc.at(-1).c > 112, mc.at(-1).c);

// --- industry maths
check('mortgage 200k 4.5% 25y', Math.abs(mortgagePayment(200000, 4.5, 25) - 1111.66) < 0.05, mortgagePayment(200000, 4.5, 25));
check('bond at par when coupon = yield', Math.abs(bondPrice(5, 10, 5) - 100) < 1e-9);
check('bond below par when yield > coupon', bondPrice(4, 10, 5) < 100);
check('longer bond moves more', (bondPrice(4, 30, 6) / bondPrice(4, 30, 5)) < (bondPrice(4, 2, 6) / bondPrice(4, 2, 5)));
const l0 = lbo({ ebitda: 20, entryMult: 10, debtPct: 0, growth: 0, years: 5, exitMult: 10, paydownPct: 0 });
check('LBO no debt, no growth = 1x', Math.abs(l0.moic - 1) < 1e-9, l0.moic);
const l6 = lbo({ ebitda: 20, entryMult: 10, debtPct: 60, growth: 5, years: 5, exitMult: 10, paydownPct: 40 });
check('LBO debt magnifies return', l6.moic > lbo({ ebitda: 20, entryMult: 10, debtPct: 0, growth: 5, years: 5, exitMult: 10, paydownPct: 40 }).moic, l6.moic);
check('call payoff', optionPnl('call', 100, 5, 110) === 5 && optionPnl('call', 100, 5, 90) === -5);
check('put payoff', optionPnl('put', 100, 5, 80) === 15 && optionPnl('put', 100, 5, 120) === -5);

// --- reading pages (m/<id>/) and sitemap.xml match the content
const built = await build();
for (const [p, text] of Object.entries(built)) {
  let disk = null;
  try { disk = readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'); } catch {}
  const lf = s => s && s.replace(/\r\n/g, '\n');
  check(`${p} up to date`, lf(disk) === lf(text), '(run node tools/build_pages.mjs)');
}
check('every lesson has a reading page', Object.keys(built).filter(p => p.endsWith('/index.html') && p !== 'm/index.html').length === course.items.filter(i => i.kind !== 'checkpoint' && course.ready.includes(i.id)).length);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
