// Runs the real schema.sql in a throwaway Postgres with stand-ins for Supabase's auth, then attacks the class rules.
import { PGlite } from '@electric-sql/pglite'; // npm i --no-save @electric-sql/pglite@0.2.17
import { readFileSync } from 'fs';
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
await db.exec(schema); // the setup page says it's safe to re-run, so prove it
await db.exec(`grant all on all tables in schema public to anon, authenticated; revoke all on public.leaderboard from public;
               grant select on public.leaderboard to anon, authenticated;`);
const U = n => `00000000-0000-4000-8000-00000000000${n}`;
const [T, T2, A, B, C] = [1, 2, 3, 4, 5].map(U);
const users = [[T, 'teach@gmail.com'], [T2, 'head@greenhill.sch.uk'], [A, 'a@x.com'], [B, 'b@x.com'], [C, 'c@x.com']];
for (const [id, email] of users) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
for (const [id, n] of [[A, 'Alpha'], [B, 'Bravo'], [C, 'Charlie'], [T, 'Teach One']]) await db.query('insert into public.profiles (user_id, nickname) values ($1, $2)', [id, n]);

async function as(uid, sql, params = []) {
  await db.exec(`reset role; select set_config('test.uid', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}
const fail = async (uid, sql, params = []) => { try { await as(uid, sql, params); return null; } catch (e) { return e.code || e.message; } };
const seed = async (u, item, at, auto = 6, passed = true) => db.query(
  `insert into public.attempts (id, user_id, kind, item_id, auto, out_of, passed, auto_passed, day, at) values (gen_random_uuid(), $1, 'quiz', $2, $3, 6, $4, $4, $5::date, $6::timestamptz)`, [u, item, auto, passed, at.slice(0, 10), at]);

// Teachers
check('gmail teacher is unverified', (await as(T, `select public.become_teacher('Ms Tan', 'Hill School') s`))[0].s === 'unverified');
check('.sch.uk teacher is verified', (await as(T2, `select public.become_teacher('Mr Lee') s`))[0].s === 'verified');
check('nobody can make themselves verified directly', (await as(T, `update public.teachers set status = 'verified' where user_id = '${T}' returning 1`)).length === 0);
check('can\'t insert a teacher row directly', Boolean(await fail(C, `insert into public.teachers (user_id, display_name, status) values ('${C}', 'Fake', 'verified')`)));
check('anon can\'t become a teacher', Boolean(await fail(null, `select public.become_teacher('X')`)));
check('student can\'t see the teacher table', (await as(A, 'select * from public.teachers')).length === 0);
check('student can\'t make a class', Boolean(await fail(A, `select public.create_class('X', 'econ-aqa')`)));
await db.query(`insert into public.teacher_domains (domain) values ('trust.org.uk')`);
await db.query(`insert into auth.users (id, email) values ('${U(6)}', 'x@maths.trust.org.uk'), ('${U(7)}', 'y@nottrust.org.uk'), ('${U(8)}', 'z@fake.sch.uk')`);
await db.query(`update auth.users set email_confirmed_at = null where id = '${U(8)}'`);
check('listed domain is verified', (await as(U(6), `select public.become_teacher('Trust') s`))[0].s === 'verified');
check('lookalike domain isn\'t', (await as(U(7), `select public.become_teacher('Nope') s`))[0].s === 'unverified');
check('unconfirmed school email isn\'t', (await as(U(8), `select public.become_teacher('Sneak') s`))[0].s === 'unverified');

// Classes
const cid = (await as(T, `select public.create_class('13A', 'econ-aqa', 'Year 13') id`))[0].id;
const cls = (await as(T, 'select * from public.teacher_classes()'))[0];
const code = cls.join_code;
check('code looks right', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
check('students can\'t list classes', (await as(A, 'select * from public.classes')).length === 0);
check('another teacher can\'t see the class', (await as(T2, 'select * from public.classes')).length === 0);
check('another teacher can\'t rename it', Boolean(await fail(T2, `select public.update_class('${cid}', 'Hacked', true, true)`)));
check('another teacher can\'t read the roster', Boolean(await fail(T2, `select * from public.class_roster('${cid}')`)));
check('a student can\'t read the roster', Boolean(await fail(A, `select * from public.class_roster('${cid}')`)));
check('a student can\'t renew the code', Boolean(await fail(A, `select public.renew_join_code('${cid}')`)));
check('a student can\'t delete the class', Boolean(await fail(A, `select public.delete_class('${cid}')`)));
check('direct update of classes does nothing', (await as(A, `update public.classes set name = 'x' returning 1`)).length === 0);

// Joining
check('preview shows class and teacher', (await as(A, `select * from public.class_preview('${code.toLowerCase()} ')`))[0]?.teacher === 'Ms Tan');
check('preview of a wrong code shows nothing', (await as(A, `select * from public.class_preview('ZZZZZZ')`)).length === 0);
check('anon can\'t preview', Boolean(await fail(null, `select * from public.class_preview('${code}')`)));
check('no consent, no join', await fail(A, `select public.join_class('${code}', 'Amy Ames', false)`) === 'CN106');
check('a teacher can\'t join their own class', await fail(T, `select public.join_class('${code}', 'Ms Tan', true)`) === 'CN103');
check('a bad name is refused', await fail(A, `select public.join_class('${code}', '<script>', true)`) === 'CN104');
check('wrong code', await fail(A, `select public.join_class('NOPE22', 'Amy', true)`) === 'CN105');
check('no nickname, no join', await fail(U(8), `select public.join_class('${code}', 'Zed Zed', true)`) === 'CN108');
await seed(A, 'econ-aqa:4.1.1.1', '2020-01-01T00:00:00Z'); // long before joining
await as(A, `select public.join_class('${code}', 'Amy Ames', true)`);
await as(B, `select public.join_class('${code}', 'Ben Bell', true)`);
check('joining twice is harmless', (await as(A, `select public.join_class('${code}', 'Amy Ames', true) id`))[0].id === cid);
check('direct insert into members is blocked', Boolean(await fail(C, `insert into public.class_members (class_id, user_id, real_name, consented_at) values ('${cid}', '${C}', 'Cat', now())`)));
check('can\'t read classmates\' rows', (await as(A, 'select * from public.class_members')).length === 1);
check('can\'t change your own join date', (await as(A, `update public.class_members set joined_at = '2000-01-01' returning 1`)).length === 0);

// Real names
const lb = await as(A, `select * from public.class_leaderboard('${cid}')`);
check('class leaderboard has nicknames only', lb.length === 2 && JSON.stringify(lb).indexOf('Ames') < 0 && JSON.stringify(lb).indexOf('Bell') < 0 && lb.some(x => x.nickname === 'Bravo'));
check('real names aren\'t in the public leaderboard', Object.keys((await as(null, 'select * from public.leaderboard limit 1'))[0]).join() === 'nickname,level,xp,pos,is_me');
const my = await as(B, 'select * from public.my_classes()');
check('a student sees their own class', my.length === 1 && my[0].real_name === 'Ben Bell' && !('join_code' in my[0]));
check('a non-member can\'t see the class leaderboard', Boolean(await fail(C, `select * from public.class_leaderboard('${cid}')`)));

// Only work from the membership window
let r = await as(T, `select * from public.class_roster('${cid}')`);
const amy = () => r.find(x => x.real_name === 'Amy Ames');
check('work from before joining is hidden', Number(amy().passed) === 0 && amy().last_active === null, JSON.stringify(amy()));
await seed(A, 'econ-aqa:4.1.1.2', new Date().toISOString());
await seed(A, 'money:nope', new Date().toISOString());
await seed(A, '01', new Date().toISOString());
r = await as(T, `select * from public.class_roster('${cid}')`);
check('work since joining counts, in this course only', Number(amy().passed) === 1);
await db.query(`insert into public.attempts (id, user_id, kind, item_id, auto, claimed, out_of, passed, auto_passed, day) values (gen_random_uuid(), '${A}', 'quiz', 'econ-aqa:4.1.1.5', 1, 5, 6, true, false, current_date)`);
r = await as(T, `select * from public.class_roster('${cid}')`);
check('a pass from self-claimed marks doesn\'t count for the teacher', Number(amy().passed) === 1);
const pts = (await as(B, `select * from public.class_leaderboard('${cid}')`));
check('class XP counts this work only', pts.find(x => x.nickname === 'Alpha').xp === 120 && pts.find(x => x.nickname === 'Alpha').is_me === false, JSON.stringify(pts));
check('money class counts bare ids', (await db.query(`select public.item_in_course('01', 'money') a, public.item_in_course('econ-aqa:1', 'money') b, public.item_in_course('econ-aqa-x:1', 'econ-aqa') c`)).rows[0].a === true);

// Leaderboard switch
await as(T, `select public.update_class('${cid}', '13A', true, false)`);
check('switched off: members can\'t see it', Boolean(await fail(A, `select * from public.class_leaderboard('${cid}')`)));
check('the teacher still can', (await as(T, `select * from public.class_leaderboard('${cid}')`)).length === 2);
await as(T, `select public.update_class('${cid}', '13A', true, true)`);

// Leaving
await as(A, `select public.leave_class('${cid}')`);
check('after leaving, the class is gone for the student', (await as(A, 'select * from public.my_classes()')).length === 0);
await new Promise(res => setTimeout(res, 20));
await seed(A, 'econ-aqa:4.1.1.4', new Date(Date.now() + 5000).toISOString());
r = await as(T, `select * from public.class_roster('${cid}')`);
check('teacher keeps past marks but gets nothing new', Number(amy().passed) === 1 && amy().left_at !== null);
check('a leaver is off the class leaderboard', (await as(B, `select * from public.class_leaderboard('${cid}')`)).length === 1);
check('a leaver can\'t see it', Boolean(await fail(A, `select * from public.class_leaderboard('${cid}')`)));
await as(A, `select public.join_class('${code}', 'Amy Ames', true)`);
r = await as(T, `select * from public.class_roster('${cid}')`);
check('rejoining starts afresh: the gap stays hidden', amy().left_at === null && new Date(amy().joined_at) > new Date('2026-01-01'));

// Closing, new codes
await as(T, `select public.update_class('${cid}', '13A', false, true)`);
check('closed to new students', await fail(C, `select public.join_class('${code}', 'Cat Cole', true)`) === 'CN101');
await as(T, `select public.update_class('${cid}', '13A', true, true)`);
const code2 = (await as(T, `select public.renew_join_code('${cid}') c`))[0].c;
check('the old code stops working', code2 !== code && await fail(C, `select public.join_class('${code}', 'Cat Cole', true)`) === 'CN105');

// Removing and nickname reset
check('a teacher can\'t reset a stranger\'s nickname', Boolean(await fail(T, `select public.reset_nickname('${cid}', '${C}')`)));
check('an unverified teacher can\'t reset nicknames', Boolean(await fail(T, `select public.reset_nickname('${cid}', '${B}')`)));
await db.query(`update public.teachers set status = 'verified' where user_id = '${T}'`);
await as(T, `select public.reset_nickname('${cid}', '${B}')`);
const pb = (await db.query(`select nickname, nickname_must_change, nickname_changed_at from public.profiles where user_id = '${B}'`)).rows[0];
check('reset hides the name and forces a new one', pb.nickname.startsWith('Learner ') && pb.nickname_must_change === true, JSON.stringify(pb));
check('the setting doesn\'t stay on', Boolean(await fail(B, `update public.profiles set nickname = 'Bravo Two'`)) === false);
const pb2 = (await db.query(`select nickname, nickname_must_change from public.profiles where user_id = '${B}'`)).rows[0];
check('the student can then pick, and the flag clears', pb2.nickname === 'Bravo Two' && pb2.nickname_must_change === false);
await as(T, `select public.remove_from_class('${cid}', '${B}')`);
check('a teacher can remove a student', (await as(B, 'select * from public.my_classes()')).length === 0);

// Capacity
const smallId = (await as(U(7), `select public.create_class('Big', 'money') id`))[0].id;
const smallCode = (await as(U(7), 'select * from public.teacher_classes()'))[0].join_code;
for (let i = 0; i < 35; i++) {
  const id = `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  await db.query(`insert into auth.users (id, email) values ('${id}', 's${i}@x.com')`);
  await db.query(`insert into public.profiles (user_id, nickname) values ('${id}', 'Kid ${i + 100}')`);
  await as(id, `select public.join_class('${smallCode}', 'Kid Name', true)`);
}
check('unverified class stops at 35', await fail(C, `select public.join_class('${smallCode}', 'Cat Cole', true)`) === 'CN102');

// Teaching plans
const planClass = (await as(T2, `select public.create_class('Plan', 'econ-aqa') id`))[0].id;
const planCode = (await as(T2, 'select * from public.teacher_classes()')).find(c => c.id === planClass).join_code;
await as(C, `select public.join_class('${planCode}', 'Cat Cole', true)`);
check('a class starts with no plan', (await as(C, 'select * from public.my_class_plans()')).length === 0);
check('a student can\'t set a plan', Boolean(await fail(C, `select public.set_class_plan('${planClass}', '{a}', '{}')`)));
check('another teacher can\'t set a plan', Boolean(await fail(T, `select public.set_class_plan('${planClass}', '{a}', '{}')`)));
check('another teacher can\'t read a plan', Boolean(await fail(T, `select * from public.class_plan('${planClass}')`)));
check('a bad topic is refused', Boolean(await fail(T2, `select public.set_class_plan('${planClass}', '{"<b>"}', '{}')`)));
await as(T2, `select public.set_class_plan('${planClass}', '{4.1.2,4.1.1}', '{4.1.3}')`);
let cp = await as(C, 'select * from public.my_class_plans()');
check('a member gets the plan', cp.length === 1 && cp[0].unit_order[0] === '4.1.2' && cp[0].held_units[0] === '4.1.3' && cp[0].course === 'econ-aqa', JSON.stringify(cp));
check('the teacher reads it back', (await as(T2, `select * from public.class_plan('${planClass}')`))[0].held_units[0] === '4.1.3');
check('a non-member gets no plan', (await as(A, 'select * from public.my_class_plans()')).length === 0);
await as(C, `select public.leave_class('${planClass}')`);
check('leaving drops the plan', (await as(C, 'select * from public.my_class_plans()')).length === 0);
await as(C, `select public.join_class('${planCode}', 'Cat Cole', true)`);
await as(T2, `select public.set_class_plan('${planClass}', null, null)`);
check('clearing goes back to the course order', (await as(C, 'select * from public.my_class_plans()')).length === 0);
await as(C, `select public.leave_class('${planClass}')`);

// Score guards: what a student could try from the browser's own connection
const fid = () => crypto.randomUUID();
const put = (u, item, extra = '') => as(u, `insert into public.attempts (id, user_id, kind, item_id, auto, out_of, passed, auto_passed, day${extra ? ', at' : ''})
  values ('${fid()}', '${u}', 'quiz', '${item}', 7, 7, true, true, current_date${extra})`);
const count = async (u, item) => (await db.query(`select count(*)::int n from public.attempts where user_id = '${u}' and item_id = '${item}'`)).rows[0].n;
await put(C, 'econ-aqa:made-up-lesson');
check('a score for a lesson that doesn\'t exist is dropped', await count(C, 'econ-aqa:made-up-lesson') === 0);
await as(C, `insert into public.attempts (id, user_id, kind, item_id, auto, out_of, passed, auto_passed, day) values ('${fid()}', '${C}', 'quiz', '01', 60, 60, true, true, current_date)`);
check('a score out of too many marks is dropped', await count(C, '01') === 0);
await as(C, `insert into public.attempts (id, user_id, kind, item_id, auto, out_of, passed, auto_passed, day) values ('${fid()}', '${C}', 'recall', '01', 40, 40, false, false, current_date)`);
check('an inflated recall is dropped', await count(C, '01') === 0);
await put(C, '01');
check('a real score is kept', await count(C, '01') === 1);
const rec = (await db.query(`select received_at from public.attempts where user_id = '${C}' and item_id = '01'`)).rows[0];
check('the server sets when it arrived', Math.abs(new Date(rec.received_at) - Date.now()) < 60000);
await put(C, '02', `, '2099-01-01'`);
check('a date in the future is pulled back to now', new Date((await db.query(`select at from public.attempts where user_id = '${C}' and item_id = '02'`)).rows[0].at).getFullYear() < 2099);
await as(C, `update public.attempts set received_at = '2000-01-01'`);
check('you can\'t change the arrival time', new Date((await db.query(`select received_at r from public.attempts where user_id = '${C}' and item_id = '01'`)).rows[0].r).getFullYear() > 2000);
check('a saved score can\'t be edited', (await as(C, `update public.attempts set auto = 7 where item_id = '01' returning 1`)).length === 0);
check('a saved score can\'t be deleted', (await as(C, `delete from public.attempts where item_id = '01' returning 1`)).length === 0 && await count(C, '01') === 1);
const dup = (await db.query(`select id from public.attempts where user_id = '${C}' and item_id = '01'`)).rows[0].id;
await as(C, `insert into public.attempts (id, user_id, kind, item_id, auto, out_of, day) values ('${dup}', '${C}', 'quiz', '01', 1, 7, current_date) on conflict (id) do nothing`);
check('a re-sent score causes no error and changes nothing', await count(C, '01') === 1);
await as(C, `insert into public.module_reads (user_id, item_id) values ('${C}', 'fake-99')`);
check('a read of a fake lesson is dropped', (await db.query(`select 1 from public.module_reads where user_id = '${C}'`)).rows.length === 0);
await as(C, `insert into public.module_reads (user_id, item_id) values ('${C}', '01')`);
check('a real read is kept', (await db.query(`select 1 from public.module_reads where user_id = '${C}'`)).rows.length === 1);
await as(C, `insert into public.active_days (user_id, day) values ('${C}', '2099-01-01'), ('${C}', '2001-01-01'), ('${C}', current_date)`);
check('only real days count towards a streak', (await db.query(`select 1 from public.active_days where user_id = '${C}'`)).rows.length === 1);
check('students can\'t read the item list', (await as(C, 'select * from public.known_items')).length === 0);
check('students can\'t change the item list', Boolean(await fail(C, `insert into public.known_items values ('x', 999)`)));

// Deleting accounts
await as(A, 'select public.delete_my_account()');
check('deleting an account removes the membership', (await db.query(`select 1 from public.class_members where user_id = '${A}'`)).rows.length === 0);
await as(T, `select public.delete_class('${cid}')`);
check('deleting a class removes its members', (await db.query(`select 1 from public.class_members where class_id = '${cid}'`)).rows.length === 0);
// Every table has RLS on
const noRls = (await db.query(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)).rows;
check('RLS on every table', noRls.length === 0, JSON.stringify(noRls));
const open = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute') and p.proname not in ('xp_for')`)).rows;
check('no privileged function is open to anon', open.length === 0, JSON.stringify(open));
console.log(`${oks} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
