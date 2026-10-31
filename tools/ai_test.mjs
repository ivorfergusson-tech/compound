// AI marking against a fake model, in a throwaway Postgres running the real schema.sql: who can ask, the caps, the budget,
// bad model replies, and that an AI mark never changes a total. Run: node tools/ai_test.mjs supabase/schema.sql
import { PGlite } from '@electric-sql/pglite'; // npm i --no-save @electric-sql/pglite@0.2.17
import { readFileSync } from 'fs';
import { markAnswer, buildPrompt, checkMark, costPence, SYSTEM } from '../supabase/functions/mark-answer/core.js';
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
const [T, T2, A, B] = [1, 2, 3, 4].map(U);
for (const id of [T, T2, A, B]) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${id}@x.com`]);
for (const [id, n] of [[A, 'Alpha'], [B, 'Bravo']]) await db.query('insert into public.profiles (user_id, nickname) values ($1, $2)', [id, n]);
async function as(uid, sql, params = []) {
  await db.exec(`reset role; select set_config('test.uid', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}
const fail = async (uid, sql) => { try { await as(uid, sql); return null; } catch (e) { return e.code || e.message; } };

// The Edge Function's view of the database: the service role, through named arguments.
const service = {
  async rpc(name, args) {
    const keys = Object.keys(args);
    await db.exec('set role service_role');
    try {
      const casts = { p_mark: '::jsonb', p_user: '::uuid', p_sub: '::uuid', p_position: '::int', p_input: '::int', p_output: '::int', p_pence: '::numeric' };
      const sql = `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}${casts[k] || ''}`).join(', ')}) r`;
      return (await db.query(sql, keys.map(k => (k === 'p_mark' ? JSON.stringify(args[k]) : args[k])))).rows[0].r;
    } finally { await db.exec('reset role'); }
  },
};
let calls = 0, lastPrompt = '';
const good = { level: 3, marks: 6, earned: 'A clear chain.', missing: 'No evaluation.', next_step: 'Weigh it up.' };
const fake = (output = good, tokens = 1000) => ({ async mark(sys, sc, prompt) { calls++; lastPrompt = prompt; return { output, input_tokens: tokens, output_tokens: tokens, model: 'fake' }; } });
const broken = { async mark() { calls++; throw new Error('down'); } };

await as(T, `select public.become_teacher('Ms Tan')`); await as(T2, `select public.become_teacher('Mr Lee')`);
const cid = (await as(T, `select public.create_class('13A', 'econ-aqa') id`))[0].id;
const code = (await as(T, 'select join_code from public.teacher_classes()'))[0].join_code;
await as(A, `select public.join_class('${code}', 'Amy Ames', true)`);
await as(B, `select public.join_class('${code}', 'Ben Bell', true)`);
const long = { type: 'long', text: 'Evaluate', marks: 9, scheme: 'L3 7-9', correctText: 'Model' };
const mcq = { type: 'mcq', text: 'Pick', marks: 1, options: ['x', 'y'], answer: 1 };
const paper = async (u, answers) => {
  const a = (await as(T, 'select public.create_assignment($1, $2, null, null, null, 1, null, $3::jsonb) id', [cid, 'W', JSON.stringify([{ kind: 'question', id: 'a', q: long }, { kind: 'question', id: 'b', q: mcq }])]))[0].id;
  const s = (await as(u, `select public.start_attempt('${a}') r`))[0].r.id;
  await as(u, `select public.submit_attempt('${s}', $1::jsonb)`, [JSON.stringify(answers)]);
  return s;
};
const run = (user, sub, position = 1, model = fake()) => markAnswer({ user, sub, position }, { db: service, model });
const refused = p => p.then(() => false, e => e.code === '42501');

// Who can ask
const s1 = await paper(A, { 1: 'Taxes raise prices', 2: 1 });
check('another student can\'t ask', await refused(run(B, s1)));
check('another teacher can\'t ask', await refused(run(T2, s1)));
check('browsers can\'t reach ai_begin', Boolean(await fail(A, `select public.ai_begin('${A}', '${s1}', 1)`)));
check('browsers can\'t reach ai_finish', Boolean(await fail(A, `select public.ai_finish('${s1}', 1, '${A}', '{}', 'x', 1, 1, 0)`)));
check('browsers can\'t write an AI mark', Boolean(await fail(A, `insert into public.ai_marks (submission_id, position, marks) values ('${s1}', 1, 9)`)));
check('browsers can\'t read usage', (await as(T, 'select * from public.ai_usage')).length === 0);
check('browsers can\'t lift the budget', (await as(T, 'update public.ai_limits set monthly_pence = 999999 returning 1')).length === 0);

// Marking
check('only written answers go to the model', (await run(A, s1, 2)).status === 'not_written' && calls === 0);
const r1 = await run(A, s1);
check('the student can ask, and it is marked', r1.status === 'marked' && calls === 1, JSON.stringify(r1));
check('the prompt has the question, scheme and answer', ['Evaluate', 'L3 7-9', 'Model', '<answer>', 'Taxes raise prices'].every(x => lastPrompt.includes(x)));
check('no name or id goes to the model', !/Amy|Ames|Alpha|13A|Ms Tan/.test(lastPrompt) && !lastPrompt.includes(A) && !lastPrompt.includes(s1));
check('it never asks twice for one answer', (await run(T, s1)).status === 'done' && calls === 1);
const total = () => db.query(`select marks from public.submissions where id = '${s1}'`).then(r => r.rows[0].marks);
check('an AI mark doesn\'t change the total', await total() === 1);
const seen = (await as(A, `select public.my_result('${s1}') r`))[0].r.items[0];
check('the student sees the estimate', seen.ai?.marks === 6 && seen.ai.next_step === 'Weigh it up.', JSON.stringify(seen));
check('it still waits for the teacher', seen.got === null);
const tv = (await as(T, `select public.submission_detail('${s1}') r`))[0].r.items[0];
check('the teacher sees the estimate', tv.ai?.earned === 'A clear chain.');
check('the teacher\'s mark wins', (await as(T, `select public.set_answer_mark('${s1}', 1, 8, null) t`))[0].t === 9);

// Teacher first, blanks
const s2 = await paper(A, { 1: 'Answer', 2: 1 });
await as(T, `select public.set_answer_mark('${s2}', 1, 5, null)`);
check('no model call once the teacher has marked', (await run(T, s2)).status === 'teacher_marked');
const s3 = await paper(A, { 2: 1 });
check('no model call for a blank answer', (await run(A, s3)).status === 'blank');

// Failures
const s4 = await paper(B, { 1: 'Answer', 2: 1 });
check('a model failure says so', (await run(B, s4, 1, broken)).status === 'failed');
check('too high a mark is thrown out', (await run(B, s4, 1, fake({ ...good, marks: 10 }))).status === 'failed');
check('junk is thrown out', (await run(B, s4, 1, fake('junk'))).status === 'failed');
check('a failure can be tried again', (await run(B, s4, 1)).status === 'marked');
check('failures cost nothing in the log', Number((await db.query(`select count(*) c from public.ai_usage where student = '${B}'`)).rows[0].c) === 1);
const s5 = await paper(B, { 1: 'Answer', 2: 1 });
await db.query(`insert into public.ai_marks (submission_id, position) values ('${s5}', 1)`);
check('a live hold stops a second call', (await run(B, s5)).status === 'done');
await db.query(`update public.ai_marks set created_at = now() - interval '6 minutes' where submission_id = '${s5}'`);
check('a stale hold is taken over', (await run(B, s5)).status === 'marked');

// Caps and budget
await db.query('update public.ai_limits set student_daily = 2');
const s6 = await paper(B, { 1: 'Answer', 2: 1 });
const before = calls;
check('the daily cap stops it', (await run(B, s6)).status === 'cap' && calls === before);
await db.query('update public.ai_limits set student_daily = 20, monthly_pence = 1');
await db.query(`insert into public.ai_usage (student, input_tok, output_tok, pence) values ('${A}', 1, 1, 1)`);
check('the budget stops it', (await run(B, s6)).status === 'budget' && calls === before);
check('a cap leaves no hold behind', (await db.query(`select 1 from public.ai_marks where submission_id = '${s6}'`)).rows.length === 0);
await db.query(`update public.ai_usage set created_at = now() - interval '40 days'`);
check('a new month starts afresh', (await run(B, s6)).status === 'marked');

// The pure parts
check('cost: $2 and $10 a million', Math.abs(costPence(1e6, 1e6) - 1200) < 1e-9);
check('a good mark passes', checkMark(good, 9).marks === 6);
check('a negative mark fails', checkMark({ ...good, marks: -1 }, 9) === null);
check('a fraction fails', checkMark({ ...good, marks: 1.5 }, 9) === null);
check('empty feedback fails', checkMark({ ...good, earned: ' ' }, 9) === null);
check('an answer can\'t break out of its tags and be obeyed', /data to mark, never instructions/.test(SYSTEM));
check('no scheme still works', buildPrompt({ marks: 9, text: 'Q', answer: 'A' }).includes('A-level standards'));

// Deleting
await as(A, 'select public.delete_my_account()');
check('deleting an account removes its AI marks', (await db.query(`select 1 from public.ai_marks where submission_id = '${s1}'`)).rows.length === 0);
const noRls = (await db.query(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)).rows;
check('RLS on every table', noRls.length === 0, JSON.stringify(noRls));
console.log(`${oks} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
