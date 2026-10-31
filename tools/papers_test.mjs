// Past papers: the catalogue's shape and copyright rule, the sums, and the rules in a throwaway Postgres.
// Run: node tools/papers_test.mjs supabase/schema.sql
import { PGlite } from '@electric-sql/pglite'; // npm i --no-save @electric-sql/pglite@0.2.17
import { readFileSync } from 'fs';
import { nextPaper, lostTopics, roughGrade, paperItem, cleanItems, pctOf } from '../js/papers.js';
import { safeLinks } from '../js/assign.js';
const db = new PGlite();
let fails = 0, oks = 0;
const check = (n, c, x = '') => { if (c) oks++; else { fails++; console.log('FAIL', n, x); } };

// Catalogue
const data = JSON.parse(readFileSync('content/courses/econ-aqa/papers.json', 'utf8'));
check('every Economics paper is listed', data.papers.length === 30, data.papers.length);
check('ids are unique', new Set(data.papers.map(p => p.id)).size === data.papers.length);
check('specimens come last', data.papers.slice(-3).every(p => p.series === 'Specimen'));
for (const p of data.papers) {
  check(`${p.id} links out, with QP and MS`, /^https:\/\//.test(p.qp) && /^https:\/\//.test(p.ms), JSON.stringify(p));
  check(`${p.id} shows its source`, Boolean(p.source));
  check(`${p.id} is 80 marks`, p.marks === 80 && p.minutes === 120);
  if (p.paper === 3) check(`${p.id} has its insert`, /^https:\/\//.test(p.insert || ''));
}
check('no paper text is stored', Object.keys(data.papers[0]).every(k => ['id', 'series', 'paper', 'name', 'marks', 'minutes', 'qp', 'insert', 'ms', 'source'].includes(k)));
const b = data.boundaries;
check('boundaries say where they came from and when', /^https:/.test(b.source) && /^https:/.test(b.official) && b.checked && b.series);
check('boundaries fall from A* to E', Object.values(b.grades).every((v, i, a) => !i || v < a[i - 1]));

// Sums
const P = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
check('next is the oldest not done', nextPaper(P, [{ paper_id: 'A' }]).id === 'B');
check('reserved papers are skipped', nextPaper(P, [], ['A', 'B']).id === 'C');
check('all done gives none', nextPaper(P, P.map(p => ({ paper_id: p.id }))) === null);
const lost = lostTopics([{ spec: 'x', got: 1, out_of: 9 }, { spec: 'y', got: 1, out_of: 2 }, { spec: 'x', got: 0, out_of: 2 }, { spec: 'z', got: 2, out_of: 2 }, { spec: '', got: 0, out_of: 25 }]);
check('biggest loss first, no untagged', lost.map(l => l.spec).join() === 'x,y' && lost[0].lost === 10, JSON.stringify(lost));
const a = (got, done_on = '2026-01-01') => ({ got, out_of: 80, done_on });
check('no grade from 2 papers', roughGrade([a(60), a(60)], b) === null);
check('no boundaries, no grade', roughGrade([a(60), a(60), a(60)], null) === null);
check('exactly on a boundary earns it', roughGrade([a(52), a(51), a(51)], { max: 240, grades: { A: 154 } }).grade === 'A');
check('one mark under doesn\'t', roughGrade([a(51), a(51), a(51)], { max: 240, grades: { A: 154 } }).grade === 'U');
check('uses the last 3 only', roughGrade([a(0, '2020-01-01'), a(79, '2026-01-01'), a(79, '2026-01-02'), a(79, '2026-01-03')], b).grade === 'A*');
check('short papers are scaled', roughGrade([{ got: 20, out_of: 40, done_on: '1' }, { got: 20, out_of: 40, done_on: '2' }, { got: 20, out_of: 40, done_on: '3' }], { max: 240, grades: { C: 120 } }).grade === 'C');
check('a good form passes', cleanItems([{ q: '1', got: '3', out_of: '4', spec: '4.1.1' }, { q: '2', got: '', out_of: '' }]).items.length === 1);
check('marks over the top are stopped', Boolean(cleanItems([{ q: '1', got: '5', out_of: '4' }]).problem));
check('an empty form is stopped', Boolean(cleanItems([{ q: '1', got: '', out_of: '' }]).problem));
check('half a row is stopped', Boolean(cleanItems([{ q: '1', got: '', out_of: '4' }]).problem || cleanItems([{ q: '1', got: '3', out_of: '' }]).problem));
check('percent', pctOf(1, 3) === 33 && pctOf(0, 0) === 0);
check('only web links are shown', safeLinks({ links: [{ label: 'a', url: 'https://x.org/a.pdf' }, { label: 'b', url: 'javascript:alert(1)' }, { label: 'c', url: 'http://x' }] }).length === 1);

// Database
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
const [T, T2, A, B] = [1, 2, 3, 4].map(U);
for (const id of [T, T2, A, B]) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${id}@x.com`]);
for (const [id, n] of [[A, 'Alpha'], [B, 'Bravo']]) await db.query('insert into public.profiles (user_id, nickname) values ($1, $2)', [id, n]);
async function as(uid, sql, params = []) {
  await db.exec(`reset role; select set_config('test.uid', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}
const code = (p) => p.then(() => null, e => e.code);
const log = (u, items, paper = 'E-J17-P1', done = '2026-10-01') => as(u, 'select public.log_paper($1, $2, $3::date, $4::jsonb) id', ['econ-aqa', paper, done, JSON.stringify(items)]);
await as(T, `select public.become_teacher('Ms Tan')`); await as(T2, `select public.become_teacher('Mr Lee')`);
const cid = (await as(T, `select public.create_class('13A', 'econ-aqa') id`))[0].id;
const jc = (await as(T, 'select join_code from public.teacher_classes()'))[0].join_code;
await as(A, `select public.join_class('${jc}', 'Amy Ames', true)`);
await db.query(`update public.class_members set joined_at = now() - interval '1 day'`);

check('anon can\'t log', Boolean(await code(log(null, [{ got: 1, out_of: 2 }]))));
const id1 = (await log(A, [{ q: '1', got: 1, out_of: 2, spec: '4.1.5' }, { q: '2', got: 8, out_of: 25, spec: '4.1.6' }]))[0].id;
const mine = await as(A, `select * from public.my_papers('econ-aqa')`);
check('the database adds it up', mine[0].got === 9 && mine[0].out_of === 27);
check('nobody else sees it', (await as(B, `select * from public.my_papers('econ-aqa')`)).length === 0);
check('it can\'t be read directly', (await as(B, 'select * from public.paper_attempts')).length === 0);
check('no marks over the top', await code(log(A, [{ got: 9, out_of: 2 }])) === 'CN211');
check('no negative marks', await code(log(A, [{ got: -1, out_of: 2 }])) === 'CN211');
check('no fractions', await code(log(A, [{ got: 1.5, out_of: 2 }])) === 'CN211');
check('no future dates', await code(log(A, [{ got: 1, out_of: 2 }], 'E-J17-P1', '2099-01-01')) === 'CN211');
check('no empty log', await code(log(A, [])) === 'CN211');
check('no odd paper id', Boolean(await code(log(A, [{ got: 1, out_of: 2 }], '<script>'))));
await as(B, `select public.set_consolidation('${id1}', 5, 5)`);
await as(B, `select public.delete_paper('${id1}')`);
check('someone else can\'t change or delete it', (await as(A, `select * from public.my_papers('econ-aqa')`))[0].cons_of === 0);
check('consolidation must make sense', await code(as(A, `select public.set_consolidation('${id1}', 9, 5)`)) === 'CN211');
await as(A, `select public.set_consolidation('${id1}', 4, 5)`);
check('consolidation saves', (await as(A, `select * from public.my_papers('econ-aqa')`))[0].cons_got === 4);

// Reserved
check('a student can\'t reserve', Boolean(await code(as(A, `select public.set_reserved('${cid}', 'E-J25-P1', true)`))));
check('another teacher can\'t', Boolean(await code(as(T2, `select public.set_reserved('${cid}', 'E-J25-P1', true)`))));
await as(T, `select public.set_reserved('${cid}', 'E-J25-P1', true)`);
check('the class is told', (await as(A, `select * from public.my_reserved_papers('econ-aqa')`))[0]?.paper_id === 'E-J25-P1');
check('another course isn\'t', (await as(A, `select * from public.my_reserved_papers('money')`)).length === 0);
check('outsiders aren\'t', (await as(B, `select * from public.my_reserved_papers('econ-aqa')`)).length === 0);
check('the teacher sees the list', (await as(T, `select * from public.class_reserved('${cid}')`)).length === 1);
await as(T, `select public.set_reserved('${cid}', 'E-J25-P1', false)`);
check('it can be released', (await as(A, `select * from public.my_reserved_papers('econ-aqa')`)).length === 0);

// A paper set as work
const item = paperItem(data.papers[0]);
const wid = (await as(T, 'select public.create_assignment($1, $2, null, null, null, 1, 120, $3::jsonb) id', [cid, 'Mock', JSON.stringify([item])]))[0].id;
check('a whole paper can be set', (await db.query(`select marks from public.assignment_items where assignment_id = '${wid}'`)).rows[0].marks === 80);
const st = (await as(A, `select public.start_attempt('${wid}') r`))[0].r;
check('the student gets the paper link', st.items[0].links[0].url === data.papers[0].qp);
check('not the mark scheme', !JSON.stringify(st.items).includes(data.papers[0].ms));
const got = (await as(T, `select public.submission_detail('${st.id}') r`).catch(() => [{}]));
const job = await db.query(`select public.ai_begin('${A}', '${st.id}', 1) r`).catch(e => ({ err: e.code }));
check('a paper in progress can\'t go to AI', job.err === '42501' || job.rows?.[0]?.r?.ok === false, JSON.stringify(job.rows));
await db.query(`insert into public.answers (submission_id, position, response) values ('${st.id}', 1, '"typed"')`);
await as(A, `select public.submit_attempt('${st.id}', '{}'::jsonb)`);
check('a whole paper never goes to AI: there is no scheme to mark against', (await db.query(`select public.ai_begin('${A}', '${st.id}', 1) r`)).rows[0].r.reason === 'not_written');
const det = (await as(T, `select public.submission_detail('${st.id}') r`))[0].r;
check('the teacher gets the mark scheme link', det.items[0].scheme === data.papers[0].ms);

// Profile
const prof = (await as(T, `select public.student_profile('${cid}', '${A}') r`))[0].r;
check('the teacher sees logged papers', prof.papers.length === 1 && prof.papers[0].got === 9, JSON.stringify(prof.papers));
await db.query(`update public.class_members set joined_at = now() + interval '1 hour' where user_id = '${A}'`);
check('not from before joining', (await as(T, `select public.student_profile('${cid}', '${A}') r`))[0].r.papers.length === 0);
await as(A, 'select public.delete_my_account()');
check('deleting an account removes its papers', (await db.query(`select 1 from public.paper_attempts where user_id = '${A}'`)).rows.length === 0);
const noRls = (await db.query(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)).rows;
check('RLS on every table', noRls.length === 0, JSON.stringify(noRls));
console.log(`${oks} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
