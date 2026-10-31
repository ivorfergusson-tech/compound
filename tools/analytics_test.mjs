// Teacher analytics in a throwaway Postgres running the real schema.sql: privacy first, then the sums.
// Run: node tools/analytics_test.mjs supabase/schema.sql
import { PGlite } from '@electric-sql/pglite'; // npm i --no-save @electric-sql/pglite@0.2.17
import { readFileSync } from 'fs';
import { heatmap, weakest, marksCsv, csvCell, topicOf, minutes, pct } from '../js/teacher.js';
import { showResponse } from '../js/assign.js';
const db = new PGlite();
let fails = 0, oks = 0;
const check = (n, c, x = '') => { if (c) oks++; else { fails++; console.log('FAIL', n, x); } };
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz default now(), confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
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
for (const id of [T, T2, A, B, C]) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${id}@x.com`]);
for (const [id, n] of [[A, 'Alpha'], [B, 'Bravo'], [C, 'Charlie']]) await db.query('insert into public.profiles (user_id, nickname) values ($1, $2)', [id, n]);
async function as(uid, sql, params = []) {
  await db.exec(`reset role; select set_config('test.uid', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}
const fail = async (uid, sql) => { try { await as(uid, sql); return null; } catch (e) { return e.code || e.message; } };

await as(T, `select public.become_teacher('Ms Tan')`); await as(T2, `select public.become_teacher('Mr Lee')`);
const cid = (await as(T, `select public.create_class('13A', 'econ-aqa') id`))[0].id;
const code = (await as(T, 'select join_code from public.teacher_classes()'))[0].join_code;
for (const [u, n] of [[A, 'Amy Ames'], [B, 'Ben Bell']]) await as(u, `select public.join_class('${code}', '${n}', true)`);
await db.query(`update public.class_members set joined_at = now() - interval '1 day'`);
const q1 = { type: 'mcq', text: 'Pick', marks: 1, spec: '4.1.5.2', options: ['x', 'y', 'z'], answer: 1 };
const q2 = { type: 'number', text: 'Sum', marks: 1, spec: '4.2.1.1', answerValue: 4, tol: 0.01 };
const a1 = (await as(T, 'select public.create_assignment($1, $2, null, null, null, 2, null, $3::jsonb) id', [cid, 'First', JSON.stringify([{ kind: 'question', id: 'a', q: q1 }, { kind: 'question', id: 'b', q: q2 }])]))[0].id;
const go = async (u, answers, seconds) => {
  const s = (await as(u, `select public.start_attempt('${a1}') r`))[0].r.id;
  await db.query(`update public.submissions set started_at = now() - interval '10 minutes' where id = '${s}'`);
  if (seconds) await as(u, `select public.beat('${s}', $1::jsonb)`, [JSON.stringify(seconds)]);
  await as(u, `select public.submit_attempt('${s}', $1::jsonb)`, [JSON.stringify(answers)]);
  return s;
};
const sA = await go(A, { 1: 1, 2: '4' }, { 1: 30, 2: 90 });
const sB = await go(B, { 1: 0, 2: '9' }, { 1: 60, 2: 30 });

// Privacy
for (const f of [`class_heatmap('${cid}')`, `question_stats('${a1}')`, `class_marks('${cid}')`]) {
  check(`a student can't call ${f.split('(')[0]}`, Boolean(await fail(A, `select * from public.${f}`)));
  check(`another teacher can't call ${f.split('(')[0]}`, Boolean(await fail(T2, `select * from public.${f}`)));
  check(`anon can't call ${f.split('(')[0]}`, Boolean(await fail(null, `select * from public.${f}`)));
}
check('a student can\'t read a profile', Boolean(await fail(B, `select public.student_profile('${cid}', '${A}')`)));
check('not even their own', Boolean(await fail(A, `select public.student_profile('${cid}', '${A}')`)));
check('another teacher can\'t read one', Boolean(await fail(T2, `select public.student_profile('${cid}', '${A}')`)));
check('an outsider\'s profile can\'t be read', Boolean(await fail(T, `select public.student_profile('${cid}', '${C}')`)));
check('the internal function is closed', Boolean(await fail(A, `select * from public.class_answers('${cid}')`)));
check('and to teachers too', Boolean(await fail(T2, `select * from public.class_answers('${cid}')`)));

// Time
const secs = async s => (await db.query(`select active_seconds a, last_beat b from public.submissions where id = '${s}'`)).rows[0];
check('time adds up', (await secs(sA)).a === 120);
check('time goes on each question', (await db.query(`select seconds s from public.answers where submission_id = '${sA}' and position = 2`)).rows[0].s === 90);
const a2 = (await as(T, 'select public.create_assignment($1, $2, null, null, null, 1, null, $3::jsonb) id', [cid, 'Second', JSON.stringify([{ kind: 'question', id: 'a', q: q1 }])]))[0].id;
const s2 = (await as(A, `select public.start_attempt('${a2}') r`))[0].r.id;
await as(A, `select public.beat('${s2}', '{"1": 99999}'::jsonb)`);
check('time can\'t beat the clock', (await secs(s2)).a < 30, (await secs(s2)).a);
await as(A, `select public.beat('${s2}', '{"1": -5, "1x": "a"}'::jsonb)`);
check('junk time is ignored', (await secs(s2)).a < 30);
check('someone else can\'t add time', Boolean(await fail(B, `select public.beat('${s2}', '{"1": 1}'::jsonb)`)));
await as(A, `select public.submit_attempt('${s2}', '{"1": 1}'::jsonb)`);
check('no time after handing in', Boolean(await fail(A, `select public.beat('${s2}', '{"1": 1}'::jsonb)`)));

// Heatmap
const rows = await as(T, `select * from public.class_heatmap('${cid}')`);
const h = heatmap(rows);
check('topics in order', h.topics.join() === '4.1.5,4.2.1', h.topics.join());
const amy = h.people.find(p => p.name === 'Amy Ames'), ben = h.people.find(p => p.name === 'Ben Bell');
check('scores by student and topic', pct(amy.cells['4.1.5'].got, amy.cells['4.1.5'].outOf) === 100 && pct(ben.cells['4.2.1'].got, ben.cells['4.2.1'].outOf) === 0);
check('the class row counts everyone', h.totals[1] === 50, h.totals.join());

// Questions
const qs = await as(T, `select * from public.question_stats('${a1}')`);
check('per question: right and answered', Number(qs[0].answered) === 2 && Number(qs[0].full_marks) === 1, JSON.stringify(qs[0]));
check('per question: average time', qs[0].avg_seconds === 45 && qs[1].avg_seconds === 60);
check('per question: most common wrong answer', qs[0].common_wrong === 0 && Number(qs[0].wrong_times) === 1);
check('it reads as the option', showResponse({ type: qs[0].type, options: qs[0].options, response: qs[0].common_wrong }) === 'x');
check('a wrong number shows as written', qs[1].common_wrong === '9');

// Overview time and start
const ov = await as(T, `select * from public.assignment_overview('${a1}')`);
check('the overview has time and start', Number(ov.find(r => r.user_id === A).seconds) === 120 && ov[0].started_at);

// Profile
await db.query(`insert into public.active_days (user_id, day) values ('${A}', current_date), ('${A}', current_date - 1), ('${A}', current_date - 2), ('${A}', current_date - 3)`);
await db.query(`update public.class_members set joined_at = now() - interval '2 days' where user_id = '${A}'`);
const p = (await as(T, `select public.student_profile('${cid}', '${A}') r`))[0].r;
check('the streak stops at joining', p.streak === 3, p.streak);
check('the profile lists work', p.work.length === 2 && p.work[0].title === 'First');
check('topics on the profile', weakest(p.topics)[0].pct === 100 || weakest(p.topics).length === 2);
const old = await as(T, `select public.student_profile('${cid}', '${B}') r`);
check('no streak, no crash', old[0].r.streak === 0);

// Joining and leaving
await db.query(`update public.class_members set joined_at = now() + interval '1 hour' where user_id = '${B}'`);
check('work from before joining is left out of the heatmap', !(await as(T, `select * from public.class_heatmap('${cid}')`)).some(r => r.user_id === B));
check('and the question figures', Number((await as(T, `select * from public.question_stats('${a1}')`))[0].answered) === 1);
check('and the spreadsheet', !(await as(T, `select * from public.class_marks('${cid}')`)).find(r => r.real_name === 'Ben Bell' && r.title === 'First').best);
await db.query(`update public.class_members set joined_at = now() - interval '1 hour' where user_id = '${B}'`);
await as(B, `select public.leave_class('${cid}')`);
check('leavers drop out of the heatmap', !(await as(T, `select * from public.class_heatmap('${cid}')`)).some(r => r.user_id === B));
check('but stay in the spreadsheet, marked as left', (await as(T, `select * from public.class_marks('${cid}')`)).find(r => r.real_name === 'Ben Bell' && r.title === 'First').left_at);
const nameLeaks = JSON.stringify(await as(A, 'select * from public.my_assignments()'));
check('no classmate\'s name reaches a student', !nameLeaks.includes('Ben Bell'));

// CSV
const csv = marksCsv(await as(T, `select * from public.class_marks('${cid}')`));
check('the CSV has a header and rows', csv.split('\r\n').length === 5 && csv.startsWith('Student,'), csv);
check('a formula is neutralised', csvCell('=HYPERLINK("x")').startsWith(`"'=`));
check('so are + - @', ['+1', '-1', '@x', ' =x'].every(x => csvCell(x).startsWith("'")));
check('real numbers stay numbers', csvCell(-3) === '-3');
check('commas and quotes are safe', csvCell('a,"b"') === '"a,""b"""');
check('a blank stays blank', csvCell(null) === '');

// Small sums
check('topic from a spec point', topicOf('4.1.5.2') === '4.1.5');
check('no spec is own questions', topicOf(null) === '');
check('minutes read well', minutes(0) === '–' && minutes(30) === 'Under 1 min' && minutes(150) === '3 min');
check('nothing out of nothing', pct(0, 0) === null);
check('weakest come first', weakest([{ spec: '4.1.1.1', got: 9, out_of: 10 }, { spec: '4.1.2.1', got: 1, out_of: 10 }])[0].topic === '4.1.2');
console.log(`${oks} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
