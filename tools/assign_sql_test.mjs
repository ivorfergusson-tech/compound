// Runs the real schema.sql in a throwaway Postgres: checks the database marks every bank question the same as the
// browser's marking, then attacks the assignment rules. Run: node tools/assign_sql_test.mjs supabase/schema.sql
import { PGlite } from '@electric-sql/pglite'; // npm i --no-save @electric-sql/pglite@0.2.17
import { readFileSync, readdirSync, existsSync } from 'fs';
import { mark, instantiate } from '../js/quiz.js';
import { normalise, stem, tokens, editDistance, wordMatches, containsPhrase, parseNumber } from '../js/marking.js';
import { freeze, statusOf, buildMock, teacherQuestion, dueSoon } from '../js/assign.js';
const db = new PGlite();
let fails = 0, oks = 0;
const check = (n, c, x = '') => { if (c) oks++; else { fails++; console.log('FAIL', n, x); } };
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz default now(), confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`);
const schema = readFileSync(process.argv[2], 'utf8');
await db.exec(schema);
await db.exec(schema);
await db.exec(`grant all on all tables in schema public to anon, authenticated; revoke all on public.leaderboard from public;
               grant select on public.leaderboard to anon, authenticated;`);
const U = n => `00000000-0000-4000-8000-00000000000${n}`;
const [T, T2, A, B, C] = [1, 2, 3, 4, 5].map(U);
for (const [id, email] of [[T, 't@gmail.com'], [T2, 'u@gmail.com'], [A, 'a@x.com'], [B, 'b@x.com'], [C, 'c@x.com']]) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
for (const [id, n] of [[A, 'Alpha'], [B, 'Bravo'], [C, 'Charlie']]) await db.query('insert into public.profiles (user_id, nickname) values ($1, $2)', [id, n]);
async function as(uid, sql, params = []) {
  await db.exec(`reset role; select set_config('test.uid', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}
const fail = async (uid, sql, params = []) => { try { await as(uid, sql, params); return null; } catch (e) { return e.code || e.message; } };

// ---------- the same marks as the browser, for every question in every course ----------
const sqlMark = async (q, r) => (await db.query('select public.mark_item($1::jsonb, $2::jsonb) m', [JSON.stringify(q), JSON.stringify(r ?? null)])).rows[0].m;
const wrongs = q => {
  switch (q.type) {
    case 'mcq': return [(q.answer + 1) % q.options.length];
    case 'tf': return [!q.answer];
    case 'number': return [String(q.answerValue + 1000), 'no idea', `£${q.answerValue}`, ` ${q.answerValue} %`, q.answerValue.toLocaleString('en-GB')];
    case 'order': return [[...q.items].reverse()];
    case 'match': return [Object.fromEntries(q.pairs.map(([l], i) => [l, q.pairs[(i + 1) % q.pairs.length][1]]))];
    default: return ['this does not explain it at all', ''];
  }
};
const rightOf = q => (q.type === 'number' ? String(q.answerValue) : q.type === 'order' ? q.items : q.type === 'match' ? Object.fromEntries(q.pairs) : q.answer);
let compared = 0, questions = 0;
for (const course of readdirSync('content/courses')) {
  const dir = `content/courses/${course}/quizzes`;
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    for (const src of JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')).questions) {
      questions++;
      const q = freeze(src);
      const jsq = { ...instantiate(src), ...q };
      const answers = q.type === 'explain' ? [...(src.tests || []).map(t => t.answer ?? t.text ?? t[0]), ...wrongs(q)] : [rightOf(q), ...wrongs(q)];
      for (const r of answers) {
        const js = mark(jsq, r).marks, sql = await sqlMark(q, r);
        const same = q.type === 'explain' || !js ? js === sql : sql === q.marks; // a right answer earns the question's full marks
        compared++;
        check(`same mark for ${src.id}`, same, `${JSON.stringify(r)}: browser ${js}, database ${sql}`);
      }
    }
  }
}
console.log(`compared ${compared} answers on ${questions} questions`);

// The parts one by one, on every word in the bank and on typos of them, as whole answers rarely hit the edge cases.
const one = async (sql, ...args) => (await db.query(`select ${sql} v`, args)).rows[0].v;
const texts = [], phrases = [];
for (const course of readdirSync('content/courses')) {
  const dir = `content/courses/${course}/quizzes`;
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) for (const q of JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')).questions) {
    for (const t of q.tests || []) texts.push(t.answer);
    for (const i of q.ideas || []) phrases.push(...i.any);
  }
}
texts.push("It's 3.5% — not £1,200.50... (see e.g. A.B.) don't", '  Tabs and new lines  ', 'a.b 1.2 .5 5. x-y *star', 'CAFÉ naïve', '');
const vocab = [...new Set([...texts, ...phrases].flatMap(tokens))];
for (const t of texts) check('normalise matches', normalise(t) === await one('public.mk_normalise($1)', t), t);
for (const w of [...vocab, 'cats', 'taxes', 'eating', 'used', 'ring', 'gas', 'does', 'bed']) check('stem matches', stem(w) === await one('public.mk_stem($1)', w), w);
const typos = w => [w.slice(1), w.slice(0, -1), `${w}s`, `${w}x`, w.length > 2 ? w[1] + w[0] + w.slice(2) : w, w.length > 3 ? `${w.slice(0, 2)}z${w.slice(3)}` : w];
for (const w of vocab) for (const t of typos(w)) {
  if (!t) continue;
  check('distance matches', editDistance(t, w) === await one('public.mk_distance($1, $2)', t, w), `${t} ${w}`);
  check('word match matches', wordMatches(t, w) === await one('public.mk_word($1, $2)', t, w), `${t} ${w}`);
}
for (const p of [...new Set(phrases)]) for (const t of [`it is ${p}`, `it is not ${p}`, `no real ${p} here`, `never a very ${p}`, p, p.split(' ')[0]]) {
  const a = tokens(t);
  check('phrase match matches', containsPhrase(a, p) === await one('public.mk_phrase($1::text[], $2)', a, p), `${t} / ${p}`);
}
for (const n of ['£926.10', '926.1', '1,234', '−3.4%', '– 5', 'about 9 years', '.5', '-.5', '5.', 'x', '', '1.2.3', '£1,000,000', '- 7 up', '3-4', '—2']) {
  const js = parseNumber(n), sql = await one('public.mk_number($1)', n);
  check('number parsing matches', Number.isNaN(js) ? sql === null : Number(sql) === js, n);
}
check('a blank order earns nothing', await sqlMark({ type: 'order', items: ['a', 'b'], marks: 1 }, []) === 0);
check('a wrong shape earns nothing', await sqlMark({ type: 'match', pairs: [['a', 'b']], marks: 1 }, 'b') === 0);
check('negated keyword earns nothing', await sqlMark({ type: 'explain', marks: 1, ideas: [{ any: ['scarcity'] }] }, 'it is not scarcity') === 0);

// ---------- set up ----------
await as(T, `select public.become_teacher('Ms Tan')`); await as(T2, `select public.become_teacher('Mr Lee')`);
const cid = (await as(T, `select public.create_class('13A', 'econ-aqa') id`))[0].id;
const code = (await as(T, 'select join_code from public.teacher_classes()'))[0].join_code;
const lesson = (await db.query(`select item_id from public.known_items where item_id like 'econ-aqa:%' limit 1`)).rows[0].item_id;
await as(A, `select public.join_class('${code}', 'Amy Ames', true)`);
await as(B, `select public.join_class('${code}', 'Ben Bell', true)`);
const mcq = { type: 'mcq', text: 'Pick', marks: 1, options: ['x', 'SECRET-OPTION'], answer: 1, correctText: 'SECRET-OPTION', whyText: 'SECRET-WHY' };
const num = { type: 'number', text: 'Sum', marks: 2, answerValue: 42, tol: 0.01, correctText: '42', whyText: 'SECRET-WHY' };
const exp = { type: 'explain', text: 'Why', marks: 9, ideas: [{ label: 'SECRET-IDEA', any: ['scarcity'] }, { label: 'b', any: ['choice'] }], correctText: 'm', whyText: 'SECRET-WHY' };
const items = [{ kind: 'question', id: 'q1', q: mcq }, { kind: 'question', id: 'q2', q: num }, { kind: 'question', id: 'q3', q: exp }];
const make = async (opts = {}, who = T, list = items) => (await as(who, 'select public.create_assignment($1, $2, null, $3, $4, $5, $6, $7::jsonb) id',
  [opts.cls || cid, opts.title || 'HW', opts.open || null, opts.due || null, opts.attempts || 1, opts.minutes || null, JSON.stringify(list)]))[0].id;
const code_of = p => p.then(() => null, e => e.code);

// ---------- who can set work ----------
check('a student can\'t set work', Boolean(await code_of(make({}, A))));
check('another teacher can\'t set work', Boolean(await code_of(make({}, T2))));
check('anon can\'t set work', Boolean(await code_of(make({}, null))));
check('empty work is refused', await code_of(make({}, T, [])) === 'CN202');
check('a broken question is refused', await code_of(make({}, T, [{ kind: 'question', id: 'x', q: { type: 'mcq', text: 'x' } }])) === 'CN202');
check('an unknown type is refused', await code_of(make({}, T, [{ kind: 'question', id: 'x', q: { type: 'bomb', text: 'x' } }])) === 'CN202');
check('a kindless item is refused', await code_of(make({}, T, [{ id: 'x', q: mcq }])) === 'CN202');
check('a fake lesson is refused', await code_of(make({}, T, [{ kind: 'lesson', id: 'econ-aqa:fake', title: 'x' }])) === 'CN202');
check('another course\'s lesson is refused', await code_of(make({}, T, [{ kind: 'lesson', id: '01', title: 'x' }])) === 'CN202');
check('due before opening is refused', await code_of(make({ open: '2030-01-02', due: '2030-01-01' })) === '23514');

// ---------- no direct access to answers ----------
const a1 = await make();
for (const t of ['assignments', 'assignment_items', 'submissions', 'answers']) {
  check(`a student can't read ${t}`, (await as(A, `select * from public.${t}`)).length === 0);
  check(`anon can't read ${t}`, (await as(null, `select * from public.${t}`).catch(() => [])).length === 0);
  check(`a teacher can't read ${t} directly`, (await as(T, `select * from public.${t}`)).length === 0);
}
check('a student can\'t insert a mark', Boolean(await fail(A, `insert into public.submissions (assignment_id, user_id, attempt, marks, submitted_at) values ('${a1}', '${A}', 1, 99, now())`)));
for (const f of ['mark_item(\'{}\'::jsonb, \'1\'::jsonb)', `finish_submission('${a1}', now(), false)`, 'q_public(\'{}\'::jsonb)', 'close_expired(null, null)']) {
  check(`a student can't call ${f.split('(')[0]}`, Boolean(await fail(A, `select public.${f}`)));
}
const start = async (u, a) => (await as(u, `select public.start_attempt('${a}') r`))[0].r;
const s1 = await start(A, a1);
check('questions reach the student', s1.items.length === 3);
check('no answer reaches the student', !/"answer"|answerValue|ideas|SECRET-WHY|SECRET-IDEA|correctText|whyText|"tol"/.test(JSON.stringify(s1.items)), JSON.stringify(s1.items));
check('options do reach the student', s1.items[0].options[1] === 'SECRET-OPTION');
check('match answers are hidden', (await db.query(`select public.q_public('{"type":"match","text":"t","pairs":[["l","r"]],"rightShown":["r"]}'::jsonb) p`)).rows[0].p.pairs[0].length === 1);
check('order answers are hidden', !('items' in (await db.query(`select public.q_public('{"type":"order","text":"t","items":["a"],"shown":["a"]}'::jsonb) p`)).rows[0].p));
check('starting again resumes', (await start(A, a1)).id === s1.id);

// ---------- saving ----------
const save = (u, s, o) => as(u, `select public.save_answers('${s}', $1::jsonb) r`, [JSON.stringify(o)]);
await save(A, s1.id, { 1: 0, 2: '£42', 99: 'junk' });
await save(A, s1.id, { 1: 1 });
const again = await start(A, a1);
check('autosave comes back on resume', again.answers['1'] === 1 && again.answers['2'] === '£42');
check('unknown positions are dropped', !('99' in again.answers));
check('someone else can\'t save to my attempt', await fail(B, `select public.save_answers('${s1.id}', '{"1":0}'::jsonb)`) === 'CN201');
check('a huge answer is refused', await code_of(save(A, s1.id, { 3: 'x'.repeat(50000) })) === 'CN207');
check('a student can\'t read a result before handing in', Boolean(await fail(A, `select public.my_result('${s1.id}')`)));

// ---------- handing in and marks ----------
const sub = (u, s, o = {}) => as(u, `select public.submit_attempt('${s}', $1::jsonb) r`, [JSON.stringify(o)]);
const done = (await sub(A, s1.id, { 3: 'because of scarcity' }))[0].r;
check('the database adds up the marks', done.marks === 4 && done.out_of === 5, JSON.stringify(done));
check('an explain is worth one mark per idea, whatever the browser says', (await db.query(`select marks from public.assignment_items where assignment_id = '${a1}' and position = 3`)).rows[0].marks === 2);
check('no second hand-in', await fail(A, `select public.submit_attempt('${s1.id}', '{}'::jsonb)`) === 'CN201');
check('no saving after handing in', await fail(A, `select public.save_answers('${s1.id}', '{"1":1}'::jsonb)`) === 'CN201');
check('no extra attempts', await fail(A, `select public.start_attempt('${a1}')`) === 'CN206');
const res = (await as(A, `select public.my_result('${s1.id}') r`))[0].r;
check('no due date and no attempts left: answers released', res.released && res.items[0].correct === 'SECRET-OPTION');
check('never the ideas list', !/SECRET-IDEA/.test(JSON.stringify(res)));
check('another student can\'t see my result', Boolean(await fail(B, `select public.my_result('${s1.id}')`)));

const a2 = await make({ due: '2099-01-01', attempts: 2 });
const s2 = await start(A, a2);
await sub(A, s2.id, { 1: 1 });
const hidden = (await as(A, `select public.my_result('${s2.id}') r`))[0].r;
check('before the due date the answers stay hidden', !hidden.released && !/SECRET/.test(JSON.stringify(hidden.items.map(i => ({ ...i, options: 0 })))));
check('second attempt is allowed', (await start(A, a2)).attempt === 2);

// ---------- the clock ----------
const a3 = await make({ minutes: 10 });
const s3 = await start(A, a3);
check('deadline comes from the server', Math.abs(Date.parse(s3.deadline) - Date.now() - 600000) < 60000);
await save(A, s3.id, { 1: 1 });
await db.query(`update public.submissions set deadline = now() - interval '1 minute' where id = '${s3.id}'`);
const late = (await save(A, s3.id, { 2: '42' }))[0].r;
check('saving after time closes the attempt', late.closed === true);
const closed = (await db.query(`select marks, auto_submitted, submitted_at, deadline from public.submissions where id = '${s3.id}'`)).rows[0];
check('work saved after time is ignored', closed.marks === 1);
check('it counts as handed in at the deadline', closed.auto_submitted && +closed.submitted_at === +closed.deadline);
const a4 = await make({ minutes: 10 });
const s4 = await start(B, a4);
await save(B, s4.id, { 1: 1 });
await db.query(`update public.submissions set deadline = now() - interval '1 minute' where id = '${s4.id}'`);
const ovr = await as(T, `select * from public.assignment_overview('${a4}')`);
check('the teacher looking closes an abandoned timed attempt', ovr.find(r => r.user_id === B).best_marks === 1 && ovr.find(r => r.user_id === B).auto_submitted);
const a4b = await make({ minutes: 10 });
const s4b = await start(B, a4b);
await db.query(`update public.submissions set deadline = now() - interval '1 minute' where id = '${s4b.id}'`);
check('a late hand-in keeps only saved work', (await sub(B, s4b.id, { 1: 1 }))[0].r.marks === 0);

// ---------- the teacher's view and marks ----------
check('another teacher can\'t see the overview', Boolean(await fail(T2, `select * from public.assignment_overview('${a1}')`)));
check('a student can\'t see the overview', Boolean(await fail(A, `select * from public.assignment_overview('${a1}')`)));
check('another teacher can\'t see the work', Boolean(await fail(T2, `select public.submission_detail('${s1.id}')`)));
check('a student can\'t see the teacher\'s view', Boolean(await fail(A, `select public.submission_detail('${s1.id}')`)));
check('a student can\'t change a mark', Boolean(await fail(A, `select public.set_answer_mark('${s1.id}', 1, 0, null)`)));
check('another teacher can\'t change a mark', Boolean(await fail(T2, `select public.set_answer_mark('${s1.id}', 1, 0, null)`)));
const det = (await as(T, `select public.submission_detail('${s1.id}') r`))[0].r;
check('the teacher sees answers and the mark', det.items.length === 3 && det.items[1].response === '£42' && det.marks === 4);
check('a mark can\'t beat the question', await fail(T, `select public.set_answer_mark('${s1.id}', 1, 2, null)`) === 'CN205');
check('a mark can\'t be negative', await fail(T, `select public.set_answer_mark('${s1.id}', 1, -1, null)`) === 'CN205');
check('the teacher\'s mark changes the total', (await as(T, `select public.set_answer_mark('${s1.id}', 3, 2, 'Good') t`))[0].t === 5);
const res2 = (await as(A, `select public.my_result('${s1.id}') r`))[0].r;
check('the student sees the new mark and comment', res2.marks === 5 && res2.items[2].got === 2 && res2.items[2].teacher_note === 'Good');
check('clearing a mark goes back to ours', (await as(T, `select public.set_answer_mark('${s1.id}', 3, null, null) t`))[0].t === 4);

// ---------- lessons ----------
const a5 = await make({ due: '2099-01-01' }, T, [{ kind: 'lesson', id: lesson, title: 'A lesson' }]);
await db.query(`insert into public.attempts (id, user_id, kind, item_id, auto, out_of, passed, auto_passed, day) values (gen_random_uuid(), '${A}', 'quiz', '${lesson}', 6, 6, true, true, current_date)`);
const ov5 = await as(T, `select * from public.assignment_overview('${a5}')`);
check('a passed lesson counts', Number(ov5.find(r => r.user_id === A).lessons_done) === 1 && Number(ov5.find(r => r.user_id === B).lessons_done) === 0);
check('the student sees it ticked', (await as(A, 'select * from public.my_assignments()')).find(x => x.id === a5).lessons[0].done === true);
check('a lessons-only row is finished', statusOf(ov5.find(r => r.user_id === A), { questions: 0, lessons: 1, due_at: '2099-01-01' }).key === 'done');

// ---------- future, archived, leaving ----------
const a6 = await make({ open: '2099-01-01' });
check('work not yet open is hidden', !(await as(A, 'select id from public.my_assignments()')).some(x => x.id === a6));
check('work not yet open can\'t be started', Boolean(await fail(A, `select public.start_attempt('${a6}')`)));
check('other classes\' work is hidden', (await as(C, 'select * from public.my_assignments()')).length === 0);
check('an outsider can\'t start it', Boolean(await fail(C, `select public.start_attempt('${a1}')`)));
const a7 = await make({ attempts: 3 });
const s7 = await start(B, a7);
await save(B, s7.id, { 1: 1 });
await as(T2, `select public.archive_assignment('${a7}')`);
check('another teacher can\'t take it down', (await as(B, 'select id from public.my_assignments()')).some(x => x.id === a7));
await as(T, `select public.archive_assignment('${a7}')`);
check('taken-down work disappears', !(await as(B, 'select id from public.my_assignments()')).some(x => x.id === a7));
check('it can\'t be saved to', await fail(B, `select public.save_answers('${s7.id}', '{"1":1}'::jsonb)`) === 'CN201');
const a8 = await make({ attempts: 3 });
const s8 = await start(B, a8);
await save(B, s8.id, { 1: 1 });
await as(B, `select public.leave_class('${cid}')`);
check('a leaver can\'t save', await fail(B, `select public.save_answers('${s8.id}', '{"1":0}'::jsonb)`) === 'CN201');
check('a leaver can\'t start', Boolean(await fail(B, `select public.start_attempt('${a1}')`)));
check('a leaver sees no work', (await as(B, 'select * from public.my_assignments()')).length === 0);
await db.query(`update public.class_members set joined_at = now() + interval '1 hour' where user_id = '${A}'`);
check('work from before joining is hidden', Boolean(await fail(T, `select public.submission_detail('${s1.id}')`)));
check('and from the overview', !(await as(T, `select * from public.assignment_overview('${a1}')`)).find(r => r.user_id === A).best_sub);
await db.query(`update public.class_members set joined_at = now() - interval '1 hour' where user_id = '${A}'`);

// ---------- mock papers and forms ----------
const pool = { a: [1, 2, 3, 4].map(i => ({ id: `a${i}`, type: 'tf', q: 'x', answer: true, paper: 1 })), b: [1, 2, 3, 4].map(i => ({ id: `b${i}`, type: 'tf', q: 'x', answer: true, paper: 2, group: 'g' })) };
const m1 = buildMock(pool, 3, { paper: 1 });
check('a mock hits its target', m1.marks === 3 && m1.questions.length === 3);
check('a mock keeps to its paper', m1.questions.every(q => q.paper === 1));
check('a mock uses one of a group', buildMock(pool, 8).questions.filter(q => q.group === 'g').length === 1);
check('a mock stops when the bank runs out', buildMock(pool, 99).marks === 5);
const spread = buildMock(pool, 2, { rng: () => 0.5 }).questions.map(q => q.id[0]).sort().join('');
check('a mock spreads across lessons', spread === 'ab', spread);
const form = { text: ' Q ', why: '', options: ['a', 'b', '', ''], right: 1, truth: 'false', value: '4.5', unit: '%', marks: '9', scheme: 'S', model: 'M' };
const tqs = ['mcq', 'tf', 'number', 'long'].map(type => teacherQuestion({ ...form, type }).q);
for (const q of tqs) check(`the ${q.type} form makes a valid question`, (await db.query('select public.q_ok($1::jsonb) ok', [JSON.stringify(q)])).rows[0].ok);
check('the mcq form marks properly', await sqlMark(tqs[0], 1) === 1 && await sqlMark(tqs[0], 0) === 0);
check('the number form marks properly', await sqlMark(tqs[2], '4.5%') === 1);
check('one option is refused', Boolean(teacherQuestion({ ...form, type: 'mcq', options: ['a', '', '', ''], right: 0 }).problem));
check('an empty right option is refused', Boolean(teacherQuestion({ ...form, type: 'mcq', right: 3 }).problem));
const due = dueSoon([{ id: 1, questions: 1, lessons: [], due_at: '2099-02-01' }, { id: 2, questions: 1, lessons: [], due_at: '2099-01-01' }, { id: 3, questions: 1, lessons: [] }, { id: 4, questions: 1, lessons: [], first_submitted: '2026-01-01' }]);
check('due soon: soonest first, finished work gone', due.map(x => x.a.id).join() === '2,1,3');

// ---------- status wording ----------
const A0 = { questions: 2, lessons: 0, due_at: '2026-01-02T00:00:00Z' };
const t0 = Date.parse('2026-01-01T00:00:00Z'), t9 = Date.parse('2026-01-03T00:00:00Z');
check('status: not started', statusOf({}, A0, t0).key === 'todo');
check('status: overdue', statusOf({}, A0, t9).key === 'overdue');
check('status: going', statusOf({ in_progress: true }, A0, t0).key === 'going');
check('status: on time', statusOf({ first_submitted: '2026-01-01T12:00:00Z' }, A0, t9).key === 'done');
check('status: late', statusOf({ first_submitted: '2026-01-02T12:00:00Z' }, A0, t9).key === 'late');
check('status: exactly on time isn\'t late', statusOf({ first_submitted: A0.due_at }, A0, t9).key === 'done');

// ---------- a teacher's own questions ----------
const longQ = { type: 'long', text: 'Evaluate', marks: 9, scheme: 'SECRET-SCHEME', correctText: 'SECRET-MODEL' };
const saveQ = (u, q, id = null) => as(u, 'select public.save_teacher_question($1, $2, $3::jsonb) id', [id, 'econ-aqa', JSON.stringify(q)]);
check('a student can\'t save a question', Boolean(await code_of(saveQ(C, longQ))));
const tq = (await saveQ(T, longQ))[0].id;
check('the teacher sees it', (await as(T, `select * from public.my_teacher_questions('econ-aqa')`)).length === 1);
check('another teacher doesn\'t', (await as(T2, `select * from public.my_teacher_questions('econ-aqa')`)).length === 0);
check('it can\'t be read directly', (await as(T, 'select * from public.teacher_questions')).length === 0);
check('another teacher can\'t edit it', Boolean(await code_of(saveQ(T2, longQ, tq))));
await as(T2, `select public.delete_teacher_question('${tq}')`);
check('another teacher can\'t delete it', (await as(T, `select * from public.my_teacher_questions('econ-aqa')`)).length === 1);
check('no marks, no question', await code_of(saveQ(T, { ...longQ, marks: 0 })) === 'CN202');
check('a keyword question can\'t be typed in', await code_of(saveQ(T, exp)) === 'CN202');

// ---------- written answers ----------
const a9 = await make({ attempts: 1 }, T, [{ kind: 'question', id: `t:${tq}`, q: longQ }, { kind: 'question', id: 'q1', q: mcq }]);
const s9 = await start(A, a9);
check('the scheme and model don\'t reach the student', !/SECRET/.test(JSON.stringify(s9.items.filter(i => i.type === 'long'))));
const r9 = (await sub(A, s9.id, { 1: 'A long answer', 2: 1 }))[0].r;
check('a written answer waits, the rest is marked', r9.marks === 1 && r9.out_of === 10, JSON.stringify(r9));
const ov9 = await as(T, `select * from public.assignment_overview('${a9}')`);
check('the teacher sees it to mark', Number(ov9.find(r => r.user_id === A).to_mark) === 1);
const det9 = (await as(T, `select public.submission_detail('${s9.id}') r`))[0].r;
check('the teacher gets the scheme', det9.items[0].scheme === 'SECRET-SCHEME');
const mid = (await as(A, `select public.my_result('${s9.id}') r`))[0].r;
check('the student never gets the scheme', !/SECRET-SCHEME/.test(JSON.stringify(mid)));
check('an unmarked answer shows as waiting', mid.items[0].got === null);
check('the teacher\'s mark completes it', (await as(T, `select public.set_answer_mark('${s9.id}', 1, 7, 'Good') t`))[0].t === 8);
check('nothing left to mark', Number((await as(T, `select * from public.assignment_overview('${a9}')`)).find(r => r.user_id === A).to_mark) === 0);
await as(T, `select public.delete_teacher_question('${tq}')`);
check('deleting a question leaves set work alone', (await as(T, `select public.submission_detail('${s9.id}') r`))[0].r.items.length === 2);

// ---------- deleting ----------
check('export gives my work', (await as(A, 'select public.my_work_export() r'))[0].r.length > 0);
await as(A, 'select public.delete_my_account()');
check('deleting an account removes its work', (await db.query(`select 1 from public.submissions where user_id = '${A}'`)).rows.length === 0);
await as(T, `select public.delete_class('${cid}')`);
check('deleting a class removes its work', (await db.query('select 1 from public.assignments')).rows.length === 0 && (await db.query('select 1 from public.answers')).rows.length === 0);
const noRls = (await db.query(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)).rows;
check('RLS on every table', noRls.length === 0, JSON.stringify(noRls));
const open = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute') and p.proname not in ('xp_for')`)).rows;
check('no privileged function is open to anon', open.length === 0, JSON.stringify(open));
const internal = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') and p.proname in ('mark_item', 'q_public', 'finish_submission', 'close_expired', 'require_open_sub', 'require_own_sub')`)).rows;
check('no marking internals are open to students', internal.length === 0, JSON.stringify(internal));
console.log(`${oks} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
