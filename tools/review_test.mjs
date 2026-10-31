// Reports, review and admin in a throwaway Postgres running the real schema.sql. Also holds privacy.html to what the site does.
// Run: node tools/review_test.mjs supabase/schema.sql
import { PGlite } from '@electric-sql/pglite'; // npm i --no-save @electric-sql/pglite@0.2.17
import { readFileSync } from 'fs';
import { pounds } from '../js/review.js';
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
const [ADMIN, REV, T, A, B] = [1, 2, 3, 4, 5].map(U);
for (const id of [ADMIN, REV, T, A, B]) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${id}@gmail.com`]);
await db.query(`insert into public.admins values ('${ADMIN}')`);
await db.query(`insert into public.reviewers values ('${REV}')`);
async function as(uid, sql, params = []) {
  await db.exec(`reset role; select set_config('test.uid', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}
const fail = async (uid, sql) => { try { await as(uid, sql); return null; } catch (e) { return e.code || e.message; } };
const report = (u, q, r = 'wrong', n = null) => as(u, 'select public.report_question($1, $2, $3)', [q, r, n]);

check('roles', (await as(ADMIN, 'select public.review_role() r'))[0].r === 'admin' && (await as(REV, 'select public.review_role() r'))[0].r === 'reviewer' && (await as(A, 'select public.review_role() r'))[0].r === null);
check('nobody can make themselves a reviewer', Boolean(await fail(A, `insert into public.reviewers values ('${A}')`)));
check('nobody can make themselves an admin', Boolean(await fail(A, `insert into public.admins values ('${A}')`)));

// Reporting
check('anon can\'t report', Boolean(await fail(null, `select public.report_question('q', 'typo', null)`)));
await report(A, 'econ-aqa:q1', 'wrong', 'Answer looks wrong');
await report(B, 'econ-aqa:q1', 'typo');
await report(A, 'econ-aqa:q1', 'unclear');
check('one open report per person and question', Number((await db.query(`select count(*) c from public.reports where user_id = '${A}'`)).rows[0].c) === 1);
check('a made-up reason is refused', Boolean(await fail(A, `select public.report_question('q2', 'rude', null)`)));
check('a very long note is refused', Boolean(await fail(A, `select public.report_question('q2', 'typo', '${'x'.repeat(501)}')`)));
for (let i = 0; i < 19; i++) await report(B, `q${i}`);
check('20 a day is the limit', await fail(B, `select public.report_question('q99', 'typo', null)`) === 'CN212');
check('reports can\'t be read directly', (await as(A, 'select * from public.reports')).length === 0);

// Who can review
for (const u of [A, T, null]) {
  check('only reviewers see reports', Boolean(await fail(u, 'select * from public.review_reports()')));
  check('only admins see totals', Boolean(await fail(u, 'select public.admin_totals()')));
}
check('a reviewer can\'t see totals', Boolean(await fail(REV, 'select public.admin_totals()')));
check('a reviewer can\'t see teachers', Boolean(await fail(REV, 'select * from public.pending_teachers()')));
const list = await as(REV, 'select * from public.review_reports()');
check('a reviewer sees reports, most reported first', list[0].question_id === 'econ-aqa:q1' && Number(list[0].same) === 2, JSON.stringify(list[0]));
check('never who sent them', !JSON.stringify(list).includes(A) && !('user_id' in list[0]));
check('a student can\'t close a report', Boolean(await fail(A, `select public.resolve_report('${list[0].id}', 'fixed')`)));
check('a bad status is refused', Boolean(await fail(REV, `select public.resolve_report('${list[0].id}', 'open')`)));
await as(REV, `select public.resolve_report('${list[0].id}', 'fixed')`);
check('a closed report leaves the list', !(await as(REV, 'select id from public.review_reports()')).some(r => r.id === list[0].id));
await report(A, 'econ-aqa:q1', 'unclear');
check('once closed, it can be reported again', (await db.query(`select 1 from public.reports where user_id = '${A}' and status = 'open'`)).rows.length >= 1);

// Teachers
await as(T, `select public.become_teacher('Ms Tan')`);
const wait = await as(ADMIN, 'select * from public.pending_teachers()');
check('the admin sees who is waiting', wait.length === 1 && wait[0].email.endsWith('gmail.com'));
check('a teacher can\'t verify themselves', Boolean(await fail(T, `select public.verify_teacher('${T}')`)));
check('a reviewer can\'t verify', Boolean(await fail(REV, `select public.verify_teacher('${T}')`)));
await as(ADMIN, `select public.verify_teacher('${T}')`);
check('the admin can', (await db.query(`select status s from public.teachers where user_id = '${T}'`)).rows[0].s === 'verified');
check('and the queue empties', (await as(ADMIN, 'select * from public.pending_teachers()')).length === 0);

// Totals
await db.query(`insert into public.ai_usage (student, input_tok, output_tok, pence) values ('${A}', 1, 1, 2.5)`);
const t = (await as(ADMIN, 'select public.admin_totals() r'))[0].r;
check('totals add up', t.teachers === 1 && t.open_reports >= 1 && Number(t.ai_pence) === 2.5 && t.ai_budget === 1000, JSON.stringify(t));
check('pounds read well', pounds(2.5) === '£0.03' && pounds(1000) === '£10.00');

// Export and deletion
const out = (await as(A, 'select public.my_more_export() r'))[0].r;
check('a report is in my export', out.reports.length >= 1 && 'past_papers' in out && 'photos' in out);
check('only my own', !JSON.stringify(out).includes('q18'));
await as(A, 'select public.delete_my_account()');
check('a deleted account\'s report stays, with no link', (await db.query(`select user_id from public.reports where note = 'Answer looks wrong'`)).rows[0].user_id === null);
check('and the reviewer still sees it', (await as(REV, 'select * from public.review_reports()')).length > 0);
const noRls = (await db.query(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)).rows;
check('RLS on every table', noRls.length === 0, JSON.stringify(noRls));

// The privacy page says what the site does
const page = readFileSync('privacy.html', 'utf8');
for (const [name, re] of [['photos and 90 days', /photo[\s\S]*90 days/i], ['time on work', /time/i], ['AI is off', /switched off/i], ['Anthropic is named', /Anthropic/], ['what stays after deletion', /no name|names nobody/i],
  ['leaving a class', /Leave class/], ['reports', /report/i], ['past papers', /past paper/i], ['grade estimate', /estimate/i], ['GitHub job not needed; Supabase', /Supabase/]]) {
  check(`privacy page covers ${name}`, re.test(page));
}
check('the page no longer calls this only a finance course', !/free finance course/.test(page));
console.log(`${oks} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
