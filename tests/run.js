// Run: node tests/run.js
// Checks marking, the quiz engine, XP, locks, recall, the course registry and progress keys. Explain questions in every quiz file
// can carry "tests": [{ "answer": "...", "marks": n }] and are all checked here.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { markExplain, parseNumber } from '../js/marking.js';
import { instantiate, mark, buildAttempt, buildCheckpoint, score, combineScores, seededRng } from '../js/quiz.js';
import { Progress, xpFromState, levelFor, courseStatus, pickRecall, mergeStates, emptyState, itemKey, attemptPct } from '../js/progress.js';
import { nicknameProblem, nicknameLock, lockMessage, passwordProblem } from '../js/nickname.js';
import { clean as cleanDisplay, newer as newerDisplay, load as loadDisplay, save as saveDisplay, DEFAULTS as DISPLAY_DEFAULTS } from '../js/display.js';
import { payslip } from '../js/calcs-money.js';
import { sma, rsi, streakChance, tradeStats, makeCandles } from '../js/calcs-trade.js';
import { mortgagePayment, bondPrice, lbo, optionPnl } from '../js/calcs-industry.js';
import { build } from '../tools/build_pages.mjs';
import { REFRESH_ID, courseOfKey, lastActive, nextItem, coursePercent, srsModules, pickRefresh, weakSpots, daysUntil, upcoming, weekPlan } from '../js/dashboard.js';
import { econCharts, ppfY, ppfCost, equilibrium, marketGap, pedRevenue, costsAt, lowestAtc, firmAtc, firmMc, priceTaker, priceMaker, kinked, surplus, discrim, labourFloor, monopsony, lorenzShare, externality, pigouTax, basketIndex, adas, multiplierK, multiplierRounds, keynesAS, keynesAt, trendAt, actualAt, cyclePhase, phillips, fisherP, bondYield } from '../js/charts-econ.js';
import { clean as cleanExams, cleanList as cleanExamList, newer as newerExams, load as loadExams, save as saveExams, MAX_EXAMS } from '../js/exams.js';

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
  for (const k of ['00', '01', '32', 'cp1', 'cp4', REFRESH_ID, 'econ-aqa:4.1.5', 'econ-aqa:4.1.5.4', 'bus-aqa:3.2']) check(`schema accepts ${k}`, re.test(k));
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

// --- dashboard (P2)
// Question ids are unique across every course (refresh and the srs table key on them); outside Money
// they start '<course>:' so courseOfKey can tell which course a missed question came from.
{
  const seen = new Map();
  for (const e of registry.courses.filter(c => c.live)) {
    const c = JSON.parse(readFileSync(new URL(`courses/${e.id}/course.json`, contentRoot)));
    for (const f of readdirSync(new URL(`courses/${e.id}/quizzes/`, contentRoot))) {
      for (const q of JSON.parse(readFileSync(new URL(`courses/${e.id}/quizzes/${f}`, contentRoot))).questions) {
        if (seen.has(q.id)) check(`question id ${q.id} unique across courses`, false, `${seen.get(q.id)} and ${e.id}`);
        seen.set(q.id, e.id);
        if (!c.legacyIds) check(`${q.id} starts ${e.id}:`, q.id.startsWith(`${e.id}:`));
        else check(`${q.id} has no course prefix`, !q.id.includes(':'));
      }
    }
  }
  check('question ids checked', seen.size > 100, seen.size);
}
for (const e of registry.courses) {
  check(`${e.id}: exams is a list`, Array.isArray(e.exams));
  for (const x of e.exams || []) check(`${e.id}: official exam has paper, date, source, url, checked`, x.paper && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.source && /^https:\/\//.test(x.url) && /^\d{4}-\d{2}-\d{2}$/.test(x.checked));
  if (e.board) check(`${e.id}: A-level entry names its spec and needs an account`, Boolean(e.spec) && e.needsAccount === true);
}
check('courseOfKey: bare is the default course', courseOfKey('05', 'money').course === 'money' && courseOfKey('05-tax-code', 'money').id === '05-tax-code');
check('courseOfKey: prefixed', courseOfKey('econ-aqa:4.1.5', 'money').course === 'econ-aqa' && courseOfKey('econ-aqa:4.1.5', 'money').id === '4.1.5');
{
  const st0 = { read: { '00': '2026-10-01T10:00:00Z', 'econ-aqa:4.1': '2026-10-03T10:00:00Z' }, attempts: [
    { kind: 'quiz', id: '01', at: '2026-10-02T10:00:00+00:00' }, { kind: 'recall', id: REFRESH_ID, at: '2026-10-09T10:00:00Z' }] };
  const la = lastActive(st0, 'money');
  check('lastActive per course', la.money === Date.parse('2026-10-02T10:00:00Z') && la['econ-aqa'] === Date.parse('2026-10-03T10:00:00Z'));
  check('lastActive ignores refresh sets', Object.keys(la).length === 2);
}
{
  const pd = new Progress({ storage: mem(), today: () => '2026-10-30' });
  const all = course.items.map(i => i.id);
  let sd = courseStatus(course.items, pd, all);
  check('nextItem: not started is the introduction', nextItem(course, sd, false) === course.items[0]);
  check('nextItem: started is the first open module', nextItem(course, sd, true).id === '01');
  check('coursePercent: none passed', coursePercent(course, sd).pct === 0 && coursePercent(course, sd).total === course.items.filter(i => i.kind === 'module').length);
  const allPassed = Object.fromEntries(course.items.map(i => [i.id, { state: i.kind === 'intro' ? 'done' : 'passed' }]));
  check('nextItem: course done is null', nextItem(course, allPassed, true) === null);
  check('coursePercent: all passed is 100', coursePercent(course, allPassed).pct === 100);
  const q1 = quizzes['01'].questions, q2 = quizzes['02'].questions;
  pd.recordAttempt({ kind: 'quiz', id: '01', auto: 2, outOf: 8, passed: false, results: [
    { qid: q1[0].id, module: 1, topic: 'topic A', correct: false }, { qid: q1[1].id, module: 1, topic: 'topic B', correct: false }, { qid: q1[2].id, module: 1, topic: 'topic C', correct: true }] });
  sd = courseStatus(course.items, pd, all);
  const ws = weakSpots(pd.state, course, id => id, sd);
  check('weakSpots: failed module listed with its best', ws.modules.length === 1 && ws.modules[0].item.id === '01' && ws.modules[0].best === 25);
  check('weakSpots: missed topics of the latest attempt', ws.topics.map(t => t.topic).join() === 'topic A,topic B' && ws.topics[0].item.id === '01');
  check('srsModules: modules with questions still being learnt', [...srsModules(pd.state, 'money').money].join() === '1');
  pd.recordAttempt({ kind: 'quiz', id: '01', auto: 7, outOf: 8, passed: true, results: [{ qid: q1[0].id, module: 1, topic: 'topic A', correct: true }] });
  sd = courseStatus(course.items, pd, all);
  const ws2 = weakSpots(pd.state, course, id => id, sd);
  check('weakSpots: passed module drops off, old misses forgotten', ws2.modules.length === 0 && ws2.topics.length === 0);
  // bank: a due one, an older due one, a not-yet-due one, a retired one and a written answer
  const bank = new Map();
  const add = (q, module) => bank.set(q.id, { q, course: 'money', module });
  const quick = q2.filter(q => q.type !== 'explain');
  const expl = q2.find(q => q.type === 'explain');
  add(q1[1], 1);
  quick.slice(0, 3).forEach(q => add(q, 2));
  if (expl) add(expl, 2);
  const srs = {
    [q1[1].id]: { box: 0, due: '2026-10-30', module: 1, misses: 1 },
    [quick[0].id]: { box: 0, due: '2026-10-20', module: 2, misses: 2 },
    [quick[1].id]: { box: 1, due: '2026-11-02', module: 2, misses: 1 },
    [quick[2].id]: { box: 4, due: '9999-12-31', module: 2, misses: 1 },
    ...(expl ? { [expl.id]: { box: 0, due: '2026-10-01', module: 2, misses: 1 } } : {}),
  };
  check('test bank has a written answer', Boolean(expl));
  const pr = pickRefresh({ srs }, bank, '2026-10-30');
  check('refresh: due first, oldest first, then the rest', pr.questions.map(b => b.q.id).join() === [quick[0].id, q1[1].id, quick[1].id].join(), pr.questions.map(b => b.q.id).join());
  check('refresh: counts due, leaves out retired and written answers', pr.due === 2 && pr.waiting === 3, `${pr.due} ${pr.waiting}`);
  check('refresh: size cap', pickRefresh({ srs }, bank, '2026-10-30', 1).questions.length === 1);
  check('refresh: empty without misses', pickRefresh({ srs: {} }, bank, '2026-10-30').questions.length === 0);
  const g = { ...quick[0], id: 'g1', group: 'same' }, g2 = { ...quick[1], id: 'g2', group: 'same' };
  const gb = new Map([['g1', { q: g, course: 'money', module: 2 }], ['g2', { q: g2, course: 'money', module: 2 }]]);
  check('refresh: one question per group', pickRefresh({ srs: { g1: { due: '2026-10-01' }, g2: { due: '2026-10-02' } } }, gb, '2026-10-30').questions.length === 1);
  // plan
  const plan = weekPlan({ days: 38, refresh: 2, weak: ws, next: course.items.find(i => i.id === '02') });
  check('plan: weeks and pace', plan.weeks === 6 && /Three or four/.test(plan.pace));
  check('plan: refresh, retake, topics, next', plan.steps.map(s => s.kind).join() === 'refresh,retake,topics,next');
  check('plan: next not repeated when it is the retake', !weekPlan({ days: 3, weak: ws, next: ws.modules[0].item }).steps.some(s => s.kind === 'next'));
  check('plan: last week is daily', /every day/.test(weekPlan({ days: 5 }).pace) && weekPlan({ days: 0 }).weeks === 1);
}
check('daysUntil', daysUntil('2026-12-07', '2026-10-30') === 38 && daysUntil('2026-10-30', '2026-10-30') === 0 && daysUntil('2026-10-29', '2026-10-30') === -1);
check('daysUntil across the clocks going back', daysUntil('2026-10-26', '2026-10-24') === 2);
{
  const up = upcoming([{ name: 'B', date: '2027-05-20' }, { name: 'Old', date: '2026-10-01' }, { name: 'A', date: '2026-12-07' }], '2026-10-30');
  check('upcoming: future only, soonest first', up.map(e => e.name).join() === 'A,B' && up[0].days === 38);
}
// --- my exams (js/exams.js)
{
  const list = cleanExamList([
    { id: 'b', name: '  Econ   mock  ', date: '2026-12-07', course: 'money' },
    { id: 'a', name: 'Physics', date: '2026-11-20' },
    { name: 'No date' }, { name: '', date: '2026-12-01' }, { name: 'Bad day', date: '2026-02-30' }, { name: 'Bad fmt', date: '7/12/2026' },
    { id: 'BAD ID!', name: 'x'.repeat(200), date: '2027-01-01', course: 'DROP TABLE' }, null, 'junk',
  ]);
  check('exams: bad ones dropped', list.length === 3, list.length);
  check('exams: soonest first, names tidied', list[0].name === 'Physics' && list[1].name === 'Econ mock' && list[1].course === 'money');
  check('exams: long names cut, bad ids and courses replaced or dropped', list[2].name.length === 60 && /^[a-z0-9-]+$/.test(list[2].id) && !('course' in list[2]));
  check('exams: at most 12', cleanExamList(Array.from({ length: 20 }, (_, k) => ({ id: `e${k}`, name: `E${k}`, date: '2026-12-01' }))).length === MAX_EXAMS);
  check('exams: clean of nothing', cleanExams(null).list.length === 0 && cleanExams(null).updatedAt === '');
  const st = mem();
  saveExams({ list: [{ id: 'a', name: 'Mock', date: '2026-12-07' }], updatedAt: '2026-10-30T10:00:00Z' }, st);
  check('exams: saved and loaded', loadExams(st).list[0].name === 'Mock' && loadExams(st).updatedAt === '2026-10-30T10:00:00Z');
  check('exams: blank storage loads empty', loadExams(mem()).list.length === 0);
  const older = { list: [{ id: 'o', name: 'Old', date: '2026-12-01' }], updatedAt: '2026-10-01T00:00:00Z' };
  const newerOne = { list: [{ id: 'n', name: 'New', date: '2026-12-01' }], updatedAt: '2026-10-02T00:00:00Z' };
  check('exams: newer copy wins', newerExams(older, newerOne).list[0].id === 'n' && newerExams(newerOne, older).list[0].id === 'n');
  const full = cleanExams({ list: Array.from({ length: 12 }, (_, k) => ({ id: `x${k}`.padEnd(40, 'a'), name: 'é'.repeat(60), date: '2026-12-01', course: 'business-aqa' })), updatedAt: new Date().toISOString() });
  check('exams: a full list fits the database limit', full.list.length === 12 && Buffer.byteLength(JSON.stringify(full)) <= 4000, Buffer.byteLength(JSON.stringify(full)));
}
check('schema: settings.exams with a size limit', /add column if not exists exams jsonb/.test(sql) && /settings_exams_ok[\s\S]{0,120}octet_length\(exams::text\) <= 4000/.test(sql));

// --- spec maps (content/courses/<id>/specmap.json): every spec point taught exactly once, ids the database accepts
for (const e of registry.courses) {
  const f = new URL(`courses/${e.id}/specmap.json`, contentRoot);
  if (!existsSync(f)) { check(`${e.id}: live A-level course has a spec map`, !e.board || !e.live); continue; }
  const sm = JSON.parse(readFileSync(f));
  check(`${e.id} spec map: names its spec, version, date, source and check date`, sm.course === e.id && sm.spec === e.spec && sm.board === e.board
    && /^\d+(\.\d+)*$/.test(sm.specVersion) && /^\d{4}-\d{2}-\d{2}$/.test(sm.specDate) && /^https:\/\//.test(sm.source) && /^\d{4}-\d{2}-\d{2}$/.test(sm.checked));
  const pointIds = sm.points.map(pt => pt.id);
  check(`${e.id} spec map: point ids unique`, new Set(pointIds).size === pointIds.length);
  check(`${e.id} spec map: every point has a section`, sm.points.every(pt => pt.title && sm.sections[pt.id.split('.').slice(0, 3).join('.')]));
  check(`${e.id} spec map: AS references look right`, sm.points.every(pt => !pt.as || /^3\.\d+\.\d+\.\d+$/.test(pt.as)));
  const where = new Map();
  const lessonIds = [];
  sm.modules.forEach((m, k) => {
    check(`${e.id} module ${m.id}: numbered in order`, m.num === k + 1);
    check(`${e.id} module ${m.id}: 3 to 8 lessons`, m.lessons.length >= 3 && m.lessons.length <= 8, m.lessons.length);
    for (const l of m.lessons) {
      lessonIds.push(l.id);
      check(`${e.id} lesson ${l.id}: id the database accepts`, idRule && new RegExp(idRule[1]).test(itemKey({ id: e.id }, l.id)));
      check(`${e.id} lesson ${l.id}: starts with its spec point`, l.id.startsWith(l.points[0]) && l.title);
      for (const pt of l.points) {
        check(`${e.id} lesson ${l.id}: point ${pt} is in the spec`, pointIds.includes(pt));
        check(`${e.id} lesson ${l.id}: point ${pt} in its module's section`, pt.startsWith(m.section + '.'));
        if (where.has(pt) && where.get(pt) !== m.id) check(`${e.id}: ${pt} taught in one module only`, false, `${where.get(pt)} and ${m.id}`);
        where.set(pt, m.id);
      }
    }
  });
  check(`${e.id} spec map: lesson ids unique`, new Set(lessonIds).size === lessonIds.length);
  const missing = pointIds.filter(pt => !where.has(pt));
  check(`${e.id} spec map: every spec point is taught`, !missing.length, missing.join(' '));
  const moduleIds = sm.modules.map(m => m.id);
  check(`${e.id} spec map: checkpoints cover modules in order`, sm.checkpoints.every(c => moduleIds.indexOf(c.covers[0]) >= 0 && moduleIds.indexOf(c.covers[1]) >= moduleIds.indexOf(c.covers[0])));
}
check('Economics spec map has all 79 section 4 points', existsSync(new URL('courses/econ-aqa/specmap.json', contentRoot)) && JSON.parse(readFileSync(new URL('courses/econ-aqa/specmap.json', contentRoot))).points.length === 79);

// --- A-level content (every course with a spec map and a course.json, live or draft): lessons follow the map,
// every question is tagged and marks its own right answer, at least N_BANK questions per spec point
check('PPF: ends of the curve', ppfY(0, 100) === 100 && ppfY(100, 100) === 0);
check('PPF: opportunity cost rises along the curve', ppfCost(10, 100) < ppfCost(50, 100) && ppfCost(50, 100) < ppfCost(80, 100) && Math.abs(ppfCost(100 * Math.SQRT1_2, 100) - 1) < 1e-9);
check('firm: MC cuts ATC at its lowest point', firmAtc(60) === 50 && firmMc(60) === 50 && firmAtc(59) > 50 && firmAtc(61) > 50);
check('perfect competition: £50 gives normal profit', priceTaker(50).q === 60 && Math.abs(priceTaker(50).profit) < 1e-9);
check('perfect competition: £70 gives abnormal profit', priceTaker(70).q === 100 && Math.abs(priceTaker(70).profit - 1600) < 1e-9);
check('perfect competition: £40 gives a loss', priceTaker(40).q === 40 && Math.abs(priceTaker(40).profit + 500) < 1e-9);
check('monopoly: MR = MC at 60 units and £80', priceMaker(110).q === 60 && priceMaker(110).p === 80 && Math.abs(priceMaker(110).profit - 1800) < 1e-9);
check('monopoly: the efficient output is higher and cheaper', priceMaker(110).efficientQ === 90 && priceMaker(110).efficientP === 65);
check('monopolistic competition: AR near 72 touches ATC, above the lowest-cost price', Math.abs(priceMaker(72).profit) < 15 && priceMaker(72).q < 60);
check('kinked demand: cost rises inside the gap leave the price at £70', kinked(0).p === 70 && kinked(25).p === 70 && kinked(25).q === 50);
check('kinked demand: a big cost rise raises the price', kinked(40).p > 70 && kinked(40).q < 50 && !kinked(40).inGap);
check('surplus: competitive output has no deadweight loss', surplus(40).cs === 800 && surplus(40).ps === 800 && surplus(40).dwl === 0);
check('surplus: restricted output shifts surplus and loses the triangle', surplus(30).cs === 450 && surplus(30).ps === 1050 && surplus(30).dwl === 100);
for (const q of [20, 25, 30, 35, 40]) check(`surplus: welfare adds up at ${q}`, surplus(q).cs + surplus(q).ps + surplus(q).dwl === 1600);
check('discrimination: the less elastic market pays more', discrim(20).pA === 60 && discrim(20).pB === 35 && discrim(20).qA === 40 && discrim(20).qB === 30);
check('discrimination: earns more than one price', Math.abs(discrim(20).profit - 2050) < 1e-9 && Math.abs(discrim(20).singleProfit - 4900 / 3) < 1e-9);
for (const c of [10, 15, 20, 25, 30]) check(`discrimination: never earns less, MC ${c}`, discrim(c).profit > discrim(c).singleProfit);
check('labour: equilibrium is £65 and 45', labourFloor(65).employed === 45 && labourFloor(65).unemployed === 0);
check('labour: a floor above equilibrium causes unemployment', labourFloor(75).employed === 35 && labourFloor(75).willing === 55 && labourFloor(75).unemployed === 20);
check('monopsony: MCL = MRP gives 30 workers at £50', monopsony().wage === 50 && monopsony().employed === 30 && 20 + 2 * 30 === 110 - 30);
check('monopsony: a floor up to £65 raises pay and jobs', monopsony(60).employed === 40 && monopsony(65).employed === 45);
check('monopsony: a floor above £65 cuts jobs again', monopsony(70).employed === 40 && monopsony(80).employed === 30);
check('lorenz: the curve runs from 0 to 1 below equality', lorenzShare(0, 0.3) === 0 && lorenzShare(1, 0.3) === 1 && lorenzShare(0.5, 0.3) < 0.5);
check('lorenz: a higher Gini leaves the poorest with less', lorenzShare(0.5, 0.6) < lorenzShare(0.5, 0.3));
check('lorenz: the area matches the Gini', (() => { let t = 0; for (let i = 0; i < 20000; i++) t += lorenzShare((i + 0.5) / 20000, 0.4) / 20000; return Math.abs(1 - 2 * t - 0.4) < 1e-4; })());
check('externality: negative production means over-production', externality('negative-production', 20).q === 30 && externality('negative-production', 20).p === 70 && externality('negative-production', 20).loss === 100);
check('externality: negative consumption means over-consumption', externality('negative-consumption', 20).q === 30 && externality('negative-consumption', 20).p === 50);
check('externality: positive production means under-production', externality('positive-production', 20).q === 50 && externality('positive-production', 20).p === 50);
check('externality: positive consumption means under-consumption', externality('positive-consumption', 20).q === 50 && externality('positive-consumption', 20).p === 70);
for (const k of ['negative-production', 'positive-production', 'negative-consumption', 'positive-consumption']) {
  const r = externality(k, 20);
  check(`externality: MSB = MSC at the optimum (${k})`, 100 + r.b - r.q === 20 + r.c + r.q);
  check(`externality: no effect leaves the market output (${k})`, externality(k, 0).q === 40 && externality(k, 0).loss === 0);
}
check('tax: none leaves the full welfare loss', pigouTax(0).q === 40 && pigouTax(0).loss === 100);
check('tax: equal to the external cost reaches the optimum', pigouTax(20).q === 30 && pigouTax(20).loss === 0 && pigouTax(20).revenue === 600);
check('tax: too big overshoots', pigouTax(40).q === 20 && pigouTax(40).loss === 100);
check('price index: no change stays at 100', basketIndex({ food: 0, energy: 0, other: 0 }) === 100);
check('price index: weights count', Math.abs(basketIndex({ food: 10, energy: 20, other: 0 }) - 104) < 1e-9);
check('price index: a small rise in a big weight can beat a big rise in a small one', basketIndex({ food: 0, energy: 0, other: 5 }) > basketIndex({ food: 0, energy: 30, other: 0 }));
check('AD/AS: starts at capacity', adas().y === 80 && adas().p === 50 && adas().gap === 0);
check('AD/AS: more demand raises output and prices', adas(20).y === 90 && adas(20).p === 60 && adas(20).gap === 10);
check('AD/AS: higher costs raise prices and cut output', adas(0, 20).y === 70 && adas(0, 20).p === 60 && adas(0, 20).gap === -10);
check('AD/AS: more capacity opens a negative gap until demand grows', adas(0, 0, 20).gap === -20 && adas(0, 0, 20).capacity === 100);
check('multiplier: MPC 0.8 gives 5', Math.abs(multiplierK(0.8) - 5) < 1e-9);
check('multiplier: rounds add up to the total', Math.abs(multiplierRounds(10, 0.8, 200) - 50) < 1e-6 && multiplierRounds(10, 0.8, 1) === 10);
check('keynesian: flat region leaves prices alone', keynesAt(100).p === 40 && keynesAt(100).y === 60 && keynesAt(100).zone === 'flat');
check('keynesian: the curve joins up at Y = 70', keynesAS(70) === 40 && Math.abs(keynesAS(70.0001) - 40) < 0.01);
check('keynesian: a high AD is near capacity with higher prices', keynesAt(200).y > 92 && keynesAt(200).y < 100 && keynesAt(200).p > 90 && keynesAt(200).zone === 'capacity');
check('keynesian: the middle has both rising', keynesAt(130).zone === 'rising' && keynesAt(130).y > 70 && keynesAt(130).p > 40);
check('cycle: the gap is positive at the peak and negative at the trough', actualAt(12.5) > trendAt(12.5) && actualAt(37.5) < trendAt(37.5));
check('cycle: names the phases', cyclePhase(12.5) === 'Peak (boom)' && cyclePhase(37.5) === 'Trough' && cyclePhase(25) === 'Downturn' && cyclePhase(45) === 'Recovery' && cyclePhase(5) === 'Recovery');
check('phillips: at the natural rate inflation equals expectations', phillips(5, 2) === 2 && phillips(5, 6) === 6);
check('phillips: lower unemployment means more inflation', phillips(3, 2) > phillips(5, 2) && phillips(8, 2) < phillips(5, 2));
check('fisher: MV = PQ', fisherP(100, 3, 150) === 2);
check('fisher: M doubles, P doubles', fisherP(200, 3, 150) === 2 * fisherP(100, 3, 150));
check('bond: yield at face value equals the coupon', bondYield(5, 100) === 5);
check('bond: a higher price means a lower yield', bondYield(5, 125) === 4 && bondYield(5, 80) === 6.25);
check('market: starts at £60 and 40', equilibrium(0, 0).p === 60 && equilibrium(0, 0).q === 40);
check('market: more demand raises price and quantity', equilibrium(20, 0).p === 70 && equilibrium(20, 0).q === 50);
check('market: more supply lowers price, raises quantity', equilibrium(0, 20).p === 50 && equilibrium(0, 20).q === 50);
check('market: gap above and below equilibrium', marketGap(80) === -40 && marketGap(40) === 40 && marketGap(60) === 0);
check('PED: inelastic price rise raises revenue', Math.abs(pedRevenue(10, -0.5).after - 1045) < 1e-9);
check('PED: elastic price rise cuts revenue', pedRevenue(10, -2).after < pedRevenue(10, -2).before);
{
  const q0 = lowestAtc(60, 1), at = costsAt(q0, 60, 1);
  check('costs: MC cuts ATC at its lowest point', Math.abs(at.mc - at.atc) < 0.05, `${at.mc} ${at.atc}`);
  check('costs: fixed costs leave MC alone', costsAt(10, 60, 1).mc === costsAt(10, 200, 1).mc);
  check('costs: TC is fixed plus variable', Math.abs(at.tc - (60 + at.avc * q0)) < 1e-6);
}
const N_BANK = 6, AOS = ['AO1', 'AO2', 'AO3', 'AO4'];
for (const e of registry.courses.filter(c => c.board)) {
  const dir = new URL(`courses/${e.id}/`, contentRoot);
  if (!existsSync(new URL('course.json', dir)) || !existsSync(new URL('specmap.json', dir))) continue;
  const c = JSON.parse(readFileSync(new URL('course.json', dir)));
  const sm = JSON.parse(readFileSync(new URL('specmap.json', dir)));
  const gl = JSON.parse(readFileSync(new URL('glossary.json', dir)));
  const mapLessons = sm.modules.flatMap(m => m.lessons.map(l => ({ ...l, module: m.id })));
  check(`${e.id}: course.json matches the registry and spec map`, c.id === e.id && c.board === e.board && c.spec === e.spec && c.specVersion === sm.specVersion);
  const lessons = c.items.filter(i => i.kind === 'module');
  const order = lessons.map(i => mapLessons.findIndex(l => l.id === i.id));
  check(`${e.id}: lessons are spec map lessons, in map order`, order.every((k, n) => k >= 0 && (n === 0 || k > order[n - 1])), order.join(','));
  if (e.live) check(`${e.id}: live course teaches every spec map lesson`, lessons.length === mapLessons.length);
  const perPoint = {};
  for (const item of lessons) {
    const ml = mapLessons.find(l => l.id === item.id);
    if (!ml) continue;
    check(`${e.id}/${item.id}: spec points match the map`, JSON.stringify(item.spec) === JSON.stringify(ml.points));
    check(`${e.id}/${item.id}: strand is its module`, item.strand === ml.module && c.strands[item.strand]);
    const md = readFileSync(new URL(`modules/${item.id}.md`, dir), 'utf8');
    for (const [, key] of md.matchAll(/\[\[(?!")([^\]|]+)/g)) check(`${e.id}/${item.id}: glossary has "${key}"`, key.toLowerCase() in gl);
    for (const sec of ['## Guess first', ':::callout idea', ':::callout exam', '## Key terms']) check(`${e.id}/${item.id}: has ${sec}`, md.includes(sec));
    for (const [, body] of md.matchAll(/:::check\n([\s\S]*?)\n:::/g)) {
      const q = instantiate(JSON.parse(body));
      check(`${e.id}/${item.id}: quick check marks its answer right`, mark(q, { mcq: q.answer, tf: q.answer, number: String(q.answerValue), match: Object.fromEntries((q.pairs || []).map(([l, r]) => [l, r])) }[q.type]).correct);
    }
    for (const [, name] of md.matchAll(/^:::chart (\w+)/gm)) check(`${e.id}/${item.id}: chart ${name} exists`, name in econCharts);
    const qz = JSON.parse(readFileSync(new URL(`quizzes/${item.id}.json`, dir)));
    check(`${e.id}/${item.id}: quiz file names its lesson`, qz.module === item.id && qz.pick >= 4 && qz.pick <= qz.questions.length);
    for (const src of qz.questions) {
      check(`${src.id}: starts ${e.id}:<its spec point>-`, src.id.startsWith(`${e.id}:${src.spec}-`));
      check(`${src.id}: tagged spec, ao, command, marks, paper, difficulty`, item.spec.includes(src.spec) && AOS.includes(src.ao) && src.command
        && Number.isInteger(src.marks) && [1, 2, 3].includes(src.paper) && [1, 2, 3].includes(src.difficulty));
      if (src.type === 'explain') {
        check(`${src.id}: marks = ideas`, src.marks === src.ideas.length);
        check(`${src.id} has 3 tests`, (src.tests || []).length >= 3);
        for (const t of src.tests || []) {
          const r = markExplain(t.answer, src.ideas);
          check(`${src.id}: "${t.answer.slice(0, 50)}"`, r.marks === t.marks, `got ${r.marks}, want ${t.marks}`);
        }
      }
      for (const randomise of [false, true]) {
        const q = instantiate(src, { rng, randomise });
        const right = { mcq: q.answer, tf: q.answer, number: String(q.answerValue), order: q.items, match: Object.fromEntries((q.pairs || []).map(([l, r]) => [l, r])), explain: q.model }[q.type];
        check(`${src.id} right answer correct (randomise=${randomise})`, mark(q, right).correct);
        check(`${src.id} text filled`, !/\{\w+\}/.test(q.text + q.whyText), q.text);
      }
      perPoint[src.spec] = (perPoint[src.spec] || 0) + 1;
    }
  }
  for (const pt of lessons.flatMap(i => i.spec)) check(`${e.id}: spec point ${pt} has at least ${N_BANK} questions`, (perPoint[pt] || 0) >= N_BANK, perPoint[pt] || 0);
  for (const [k, g] of Object.entries(gl)) check(`${e.id} glossary ${k}: lesson exists`, lessons.some(i => i.id === g.module));
  for (const id of c.ready) check(`${e.id}/${id}: ready lesson exists`, lessons.some(i => i.id === id));
}

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
