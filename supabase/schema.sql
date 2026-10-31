-- Compound: database setup. Run once in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run: it drops and recreates the functions, view and policies (not your data).
--
-- Privacy model: Row Level Security on every table, each user reads and writes only their own rows.
-- The public leaderboard view exposes nickname, level and XP only. XP is worked out here from the
-- stored facts with the same rules as js/progress.js (XP_RULES), never sent by the browser.

-- ---------- tables ----------
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  nickname   text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_nickname_lower on public.profiles (lower(nickname));

create table if not exists public.module_reads (
  user_id   uuid not null references auth.users (id) on delete cascade,
  item_id   text not null,
  read_at   timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table if not exists public.attempts (
  id          uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('quiz', 'checkpoint', 'recall')),
  item_id     text not null,
  auto        int  not null check (auto >= 0),
  claimed     int  not null default 0 check (claimed >= 0),
  out_of      int  not null check (out_of between 1 and 60 and auto + claimed <= out_of),
  passed      boolean not null default false,
  auto_passed boolean not null default false,
  missed      text[] not null default '{}',
  wrong       text[] not null default '{}',
  "right"     text[] not null default '{}',
  day         date not null,
  at          timestamptz not null default now()
);
create index if not exists attempts_user on public.attempts (user_id);

-- Item ids: Money's are bare ('01', 'cp1'); other courses prefix the course id ('econ-aqa:4.1.5').
alter table public.module_reads drop constraint if exists module_reads_item_id_check;
alter table public.module_reads drop constraint if exists module_reads_item_id_ok;
alter table public.module_reads add constraint module_reads_item_id_ok
  check (item_id ~ '^([0-9a-z]{2,4}|[a-z0-9-]{2,30}:[0-9a-z.-]{1,40})$');
alter table public.attempts drop constraint if exists attempts_item_id_check;
alter table public.attempts drop constraint if exists attempts_item_id_ok;
alter table public.attempts add constraint attempts_item_id_ok
  check (item_id ~ '^([0-9a-z]{2,4}|[a-z0-9-]{2,30}:[0-9a-z.-]{1,40})$');

-- A module quiz's recall check part (added 29 Oct 2026). auto/claimed/out_of stay the quiz part only,
-- so XP is unchanged; passed and auto_passed count both parts together. 0 out of 0 = no recall part.
alter table public.attempts add column if not exists recall_auto    int not null default 0;
alter table public.attempts add column if not exists recall_claimed int not null default 0;
alter table public.attempts add column if not exists recall_out_of  int not null default 0;
alter table public.attempts drop constraint if exists attempts_recall_ok;
alter table public.attempts add constraint attempts_recall_ok
  check (recall_auto >= 0 and recall_claimed >= 0 and recall_out_of between 0 and 20
         and recall_auto + recall_claimed <= recall_out_of);

create table if not exists public.srs (
  user_id uuid not null references auth.users (id) on delete cascade,
  qid     text not null,
  box     int  not null,
  due     date not null,
  module  int,
  misses  int  not null default 0,
  at      timestamptz not null default now(),
  primary key (user_id, qid)
);

create table if not exists public.notes (
  user_id    uuid not null references auth.users (id) on delete cascade,
  item_id    text not null,
  text       text not null check (length(text) <= 20000),
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table if not exists public.guesses (
  user_id uuid not null references auth.users (id) on delete cascade,
  key     text not null,
  value   text not null check (length(value) <= 5000),
  primary key (user_id, key)
);

create table if not exists public.active_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  primary key (user_id, day)
);

-- Display settings (font, spacing, text size, contrast, theme), so they follow the account to any device.
create table if not exists public.settings (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  display    jsonb not null default '{}' check (jsonb_typeof(display) = 'object' and octet_length(display::text) <= 2000),
  updated_at timestamptz not null default now()
);
-- P2: exam dates the learner adds for the dashboard countdown: { "list": [{ id, name, date, course? }], "updatedAt" }.
alter table public.settings add column if not exists exams jsonb not null default '{}';
alter table public.settings drop constraint if exists settings_exams_ok;
alter table public.settings add constraint settings_exams_ok
  check (jsonb_typeof(exams) = 'object' and octet_length(exams::text) <= 4000);

-- ---------- row level security: own rows only ----------
do $$
declare t text;
begin
  foreach t in array array['profiles', 'module_reads', 'attempts', 'srs', 'notes', 'guesses', 'active_days', 'settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated
                    using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- ---------- nickname filter (also checked in the browser: js/nickname.js) ----------
create or replace function public.nickname_ok(n text) returns boolean
language plpgsql immutable as $$
declare
  low  text := translate(lower(n), '013457', 'oieast');
  flat text := regexp_replace(low, '[^a-z]', '', 'g');
  words text[] := regexp_split_to_array(low, '[^a-z]+');
  w text;
begin
  if n !~ '^[A-Za-z0-9_\- ]{3,20}$' then return false; end if;
  -- anywhere in the name (no innocent words contain these)
  foreach w in array array['fuck','shit','bitch','wank','twat','pussy','slut','whore','nigg','faggot',
    'retard','spastic','tranny','hitler','asshole','bollock','porn','jizz','dildo','bellend','paedo','pedo'] loop
    if position(w in flat) > 0 then return false; end if;
  end loop;
  -- only as a whole word (so Essex, Dickens, grape and Scunthorpe are fine)
  foreach w in array array['sex','cum','arse','rape','dick','cock','tits','paki','boob','prick','minge','spaz',
    'penis','vagina','kike','chink','nazi','fag','fags','bastard','wanker','tit','nonce','cunt','cunts','cunty'] loop
    if w = any(words) then return false; end if;
  end loop;
  return true;
end $$;

alter table public.profiles drop constraint if exists profiles_nickname_ok;
alter table public.profiles add constraint profiles_nickname_ok check (public.nickname_ok(nickname));

-- ---------- nickname lock: 7 days after it's set or changed (also shown in the browser: js/nickname.js) ----------
-- nickname_changed_at: when the lock started (null = free to change; rows from before the lock start free).
-- nickname_must_change: set when a teacher resets an unsuitable nickname (classes, P4). The student must then
-- pick a new one straight away, and that forced pick doesn't restart the lock. Only the teacher reset function
-- (added with classes) may set the flag, by turning on compound.nickname_reset for its own transaction;
-- whatever a user sends for these two columns is ignored.
alter table public.profiles add column if not exists nickname_changed_at  timestamptz;
alter table public.profiles add column if not exists nickname_must_change boolean not null default false;

create or replace function public.nickname_lock() returns trigger
language plpgsql as $$
declare
  free_at timestamptz;
  by_teacher boolean := coalesce(current_setting('compound.nickname_reset', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    new.nickname_changed_at := now();
    new.nickname_must_change := false;
    return new;
  end if;
  if by_teacher then return new; end if;
  new.nickname_must_change := old.nickname_must_change;
  new.nickname_changed_at := old.nickname_changed_at;
  if new.nickname is distinct from old.nickname then
    if old.nickname_must_change then
      new.nickname_must_change := false; -- forced pick: the lock clock is left as it was
    else
      free_at := old.nickname_changed_at + interval '7 days';
      if free_at > now() then
        raise exception 'nickname locked until %', to_char(free_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          using errcode = 'CN001', hint = 'Nicknames can change once every 7 days.';
      end if;
      new.nickname_changed_at := now();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_nickname_lock on public.profiles;
create trigger profiles_nickname_lock before insert or update on public.profiles
  for each row execute function public.nickname_lock();

-- ---------- XP (same rules as js/progress.js XP_RULES) ----------
create or replace function public.xp_for(uid uuid) returns int
language sql stable security definer set search_path = public as $$
  with
  reading as (select count(*) * 20 as xp from module_reads where user_id = uid),
  best as (
    select item_id, max(kind) as kind, max(auto) as best_auto, bool_or(auto_passed) as auto_passed
    from attempts where user_id = uid and kind <> 'recall' group by item_id
  ),
  marks as (
    select coalesce(sum(best_auto * 10 + case when auto_passed then (case when kind = 'checkpoint' then 150 else 50 end) else 0 end), 0) as xp
    from best
  ),
  recall as (
    select coalesce(sum(auto * 5), 0) as xp from (
      select distinct on (item_id, day) auto from attempts
      where user_id = uid and kind = 'recall' order by item_id, day, at
    ) r
  ),
  days as (select day, day - (row_number() over (order by day))::int as grp from active_days where user_id = uid),
  runs as (select count(*) as len from days group by grp),
  streak as (
    select (select count(*) * 10 from active_days where user_id = uid)
         + coalesce((select sum(floor(len / 7.0) * 50) from runs), 0) as xp
  )
  select ((select xp from reading) + (select xp from marks) + (select xp from recall) + (select xp from streak))::int
$$;
-- Must stay callable by anon and authenticated: a view checks function rights as the viewer, so the leaderboard needs it.
-- It only gives XP for a known user id, and ids are never shown on the site.
grant execute on function public.xp_for(uuid) to anon, authenticated, service_role;

-- Level L starts at 50·L·(L−1) XP.
create or replace function public.level_for(xp int) returns int
language sql immutable as $$ select floor((1 + sqrt(1 + 0.08 * xp)) / 2)::int $$;

-- ---------- admins: preview accounts (everything unlocked, nothing saved, off the leaderboard) ----------
-- Rows are added by hand in the SQL editor. Each account can only see whether it is an admin itself.
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security;
drop policy if exists "admins: see own row" on public.admins;
create policy "admins: see own row" on public.admins for select using (user_id = (select auth.uid()));

-- ---------- public leaderboard: nickname, level, XP only ----------
drop view if exists public.leaderboard;
create view public.leaderboard as
  select nickname, public.level_for(xp) as level, xp,
         rank() over (order by xp desc) as pos,
         (user_id = (select auth.uid())) as is_me
  from (select user_id, nickname, public.xp_for(user_id) as xp from public.profiles
        where user_id not in (select user_id from public.admins)) s;
grant select on public.leaderboard to anon, authenticated;

-- ---------- delete my account: removes the login and every row (all tables cascade) ----------
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- score guards ----------
-- Quizzes are marked in the browser, so a score can't be proved here. These rules limit what a forged one can do:
-- scores can't be changed or deleted once saved, the server's clock decides when work arrived, and a score only
-- counts for a real item and out of no more marks than its quiz can give. Doubtful rows are dropped quietly and
-- never refused, because one refused row would fail a real learner's whole sync.
alter table public.attempts add column if not exists received_at timestamptz not null default now();

create table if not exists public.known_items (
  item_id text primary key,
  max_out int not null check (max_out >= 0)
);
alter table public.known_items enable row level security; -- no policies: only the checks below read it

-- known items: start (written by tools/known_items.py)
delete from public.known_items;
insert into public.known_items (item_id, max_out) values
  ('00', 0),
  ('01', 12),
  ('02', 12),
  ('03', 13),
  ('04', 12),
  ('05', 12),
  ('06', 12),
  ('07', 13),
  ('08', 12),
  ('09', 12),
  ('10', 12),
  ('11', 13),
  ('12', 13),
  ('13', 12),
  ('14', 12),
  ('15', 12),
  ('16', 13),
  ('17', 12),
  ('18', 12),
  ('19', 12),
  ('20', 12),
  ('21', 13),
  ('22', 12),
  ('23', 12),
  ('24', 12),
  ('25', 13),
  ('26', 12),
  ('27', 12),
  ('28', 12),
  ('29', 12),
  ('30', 13),
  ('31', 12),
  ('32', 13),
  ('cp1', 60),
  ('cp2', 60),
  ('cp3', 60),
  ('cp4', 60),
  ('econ-aqa:4.1.1.1', 9),
  ('econ-aqa:4.1.1.2', 12),
  ('econ-aqa:4.1.1.4', 9),
  ('econ-aqa:4.1.1.5', 9),
  ('econ-aqa:4.1.2.1', 9),
  ('econ-aqa:4.1.2.2', 9),
  ('econ-aqa:4.1.2.3', 9),
  ('econ-aqa:4.1.2.4', 9),
  ('econ-aqa:4.1.3.1', 9),
  ('econ-aqa:4.1.3.2', 10),
  ('econ-aqa:4.1.3.3', 9),
  ('econ-aqa:4.1.3.4', 9),
  ('econ-aqa:4.1.3.5', 9),
  ('econ-aqa:4.1.3.6', 9),
  ('econ-aqa:4.1.4.1', 10),
  ('econ-aqa:4.1.4.3', 9),
  ('econ-aqa:4.1.4.4', 9),
  ('econ-aqa:4.1.4.5', 9),
  ('econ-aqa:4.1.4.6', 9),
  ('econ-aqa:4.1.4.7', 9),
  ('econ-aqa:4.1.4.8', 9),
  ('econ-aqa:4.1.5.1', 9),
  ('econ-aqa:4.1.5.10', 9),
  ('econ-aqa:4.1.5.11', 9),
  ('econ-aqa:4.1.5.2', 10),
  ('econ-aqa:4.1.5.3', 10),
  ('econ-aqa:4.1.5.4', 9),
  ('econ-aqa:4.1.5.5a', 9),
  ('econ-aqa:4.1.5.5b', 10),
  ('econ-aqa:4.1.5.6', 10),
  ('econ-aqa:4.1.5.7', 9),
  ('econ-aqa:4.1.5.8', 9),
  ('econ-aqa:4.1.5.9', 9),
  ('econ-aqa:4.1.6.1', 9),
  ('econ-aqa:4.1.6.2', 9),
  ('econ-aqa:4.1.6.3', 9),
  ('econ-aqa:4.1.6.4', 9),
  ('econ-aqa:4.1.6.5', 9),
  ('econ-aqa:4.1.6.6', 9),
  ('econ-aqa:4.1.6.7', 9),
  ('econ-aqa:4.1.7.1', 10),
  ('econ-aqa:4.1.7.2', 9),
  ('econ-aqa:4.1.7.3', 9),
  ('econ-aqa:4.1.8.1', 9),
  ('econ-aqa:4.1.8.10', 9),
  ('econ-aqa:4.1.8.2', 9),
  ('econ-aqa:4.1.8.3', 9),
  ('econ-aqa:4.1.8.4', 9),
  ('econ-aqa:4.1.8.5', 9),
  ('econ-aqa:4.1.8.6', 9),
  ('econ-aqa:4.1.8.7', 9),
  ('econ-aqa:4.1.8.8', 9),
  ('econ-aqa:4.1.8.9a', 9),
  ('econ-aqa:4.1.8.9b', 9),
  ('econ-aqa:4.2.1.1', 9),
  ('econ-aqa:4.2.1.2', 9),
  ('econ-aqa:4.2.1.3', 9),
  ('econ-aqa:4.2.1.4', 9),
  ('econ-aqa:4.2.2.1', 9),
  ('econ-aqa:4.2.2.2', 9),
  ('econ-aqa:4.2.2.3', 9),
  ('econ-aqa:4.2.2.4', 9),
  ('econ-aqa:4.2.2.5', 9),
  ('econ-aqa:4.2.2.6', 9),
  ('econ-aqa:4.2.3.1a', 9),
  ('econ-aqa:4.2.3.1b', 9),
  ('econ-aqa:4.2.3.2a', 9),
  ('econ-aqa:4.2.3.2b', 9),
  ('econ-aqa:4.2.3.3a', 9),
  ('econ-aqa:4.2.3.3b', 9),
  ('econ-aqa:4.2.3.4', 9),
  ('econ-aqa:4.2.4.1', 9),
  ('econ-aqa:4.2.4.2', 9),
  ('econ-aqa:4.2.4.3a', 9),
  ('econ-aqa:4.2.4.3b', 9),
  ('econ-aqa:4.2.4.4', 9),
  ('econ-aqa:4.2.5.1a', 9),
  ('econ-aqa:4.2.5.1b', 9),
  ('econ-aqa:4.2.5.1c', 9),
  ('econ-aqa:4.2.5.2', 9),
  ('econ-aqa:4.2.6.1', 9),
  ('econ-aqa:4.2.6.2a', 9),
  ('econ-aqa:4.2.6.2b', 9),
  ('econ-aqa:4.2.6.3a', 9),
  ('econ-aqa:4.2.6.3b', 9),
  ('econ-aqa:4.2.6.4', 9),
  ('econ-aqa:4.2.6.5a', 9),
  ('econ-aqa:4.2.6.5b', 9),
  ('econ-aqa:cp1', 60),
  ('econ-aqa:cp2', 60),
  ('econ-aqa:cp3', 60),
  ('econ-aqa:cp4', 60),
  ('econ-aqa:exam-1', 0),
  ('econ-aqa:exam-2', 0),
  ('econ-aqa:exam-3', 0),
  ('econ-aqa:exam-4', 0),
  ('rf', 60);
-- known items: end

-- Saved scores are permanent: learners can add and read them, never edit or delete them. Deleting an account still removes them.
drop policy if exists "own rows" on public.attempts;
drop policy if exists "attempts: see own" on public.attempts;
drop policy if exists "attempts: add own" on public.attempts;
create policy "attempts: see own" on public.attempts for select to authenticated using (user_id = (select auth.uid()));
create policy "attempts: add own" on public.attempts for insert to authenticated with check (user_id = (select auth.uid()));

create or replace function public.attempts_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare top int;
begin
  if exists (select 1 from attempts where id = new.id) then return new; end if; -- a re-send: the conflict rule ignores it
  select max_out into top from known_items where item_id = new.item_id;
  if top is null or new.out_of > (case when new.kind = 'recall' and new.item_id <> 'rf' then 12 else top end) then return null; end if;
  new.received_at := now();
  new.at := least(new.at, now());
  return new;
end $$;
drop trigger if exists attempts_guard on public.attempts;
create trigger attempts_guard before insert on public.attempts for each row execute function public.attempts_guard();
revoke execute on function public.attempts_guard() from public, anon, authenticated;

create or replace function public.reads_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from known_items where item_id = new.item_id) then return null; end if;
  return new;
end $$;
drop trigger if exists reads_guard on public.module_reads;
create trigger reads_guard before insert on public.module_reads for each row execute function public.reads_guard();
revoke execute on function public.reads_guard() from public, anon, authenticated;

-- A streak can't be built from days that haven't happened, or from before Compound existed.
create or replace function public.days_guard() returns trigger
language plpgsql as $$
begin
  if new.day > current_date + 1 or new.day < date '2026-01-01' then return null; end if;
  return new;
end $$;
drop trigger if exists days_guard on public.active_days;
create trigger days_guard before insert on public.active_days for each row execute function public.days_guard();
revoke execute on function public.days_guard() from public, anon, authenticated;

-- ---------- P4: teachers and classes ----------
-- Privacy model: nothing here can be written directly, and students can't read classes directly. Every change goes
-- through a function below that checks who is asking. Real names are only ever returned to the class's own teacher;
-- classmates see nicknames. A teacher sees a student's work only between joining and leaving.
create table if not exists public.teacher_domains (
  domain text primary key check (domain = lower(domain))
);

create table if not exists public.teachers (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 2 and 60),
  school       text check (length(school) <= 100),
  status       text not null default 'unverified' check (status in ('unverified', 'verified')),
  created_at   timestamptz not null default now(),
  verified_at  timestamptz
);

create table if not exists public.classes (
  id             uuid primary key default gen_random_uuid(),
  teacher_id     uuid not null references auth.users (id) on delete cascade,
  name           text not null check (length(btrim(name)) between 1 and 60),
  course         text not null check (course ~ '^[a-z0-9-]{2,30}$'),
  year_group     text check (length(year_group) <= 20),
  join_code      text not null unique check (join_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  joining_open   boolean not null default true,
  leaderboard_on boolean not null default true,
  plan           text not null default 'free',
  created_at     timestamptz not null default now()
);
create index if not exists classes_teacher on public.classes (teacher_id);

create table if not exists public.class_members (
  class_id     uuid not null references public.classes (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  real_name    text not null check (real_name ~ '^[^0-9<>@/\\]{2,60}$' and length(btrim(real_name)) >= 2),
  consented_at timestamptz not null,
  joined_at    timestamptz not null default now(),
  left_at      timestamptz,
  primary key (class_id, user_id)
);
create index if not exists class_members_user on public.class_members (user_id);

alter table public.teacher_domains enable row level security;
alter table public.teachers enable row level security;
alter table public.classes enable row level security;
alter table public.class_members enable row level security;
-- Reads only, and only your own. There are deliberately no insert, update or delete policies.
drop policy if exists "teachers: see own row" on public.teachers;
create policy "teachers: see own row" on public.teachers for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "classes: teacher sees own" on public.classes;
create policy "classes: teacher sees own" on public.classes for select to authenticated using (teacher_id = (select auth.uid()));
drop policy if exists "class_members: see own row" on public.class_members;
create policy "class_members: see own row" on public.class_members for select to authenticated using (user_id = (select auth.uid()));

-- Six characters from an alphabet of 32 with no I, O, 0 or 1, as those are easily misread.
create or replace function public.new_join_code() returns text
language plpgsql volatile as $$
declare
  a constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  c text := '';
  i int;
begin
  for i in 0..5 loop c := c || substr(a, 1 + (get_byte(b, i) % 32), 1); end loop;
  return c;
end $$;
revoke execute on function public.new_join_code() from public, anon, authenticated;

create or replace function public.require_user() returns uuid
language plpgsql stable as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return auth.uid();
end $$;

-- The class must belong to whoever is asking. Same error for "not yours" and "doesn't exist", so ids can't be probed.
create or replace function public.require_own_class(p_class uuid) returns public.classes
language plpgsql stable security definer set search_path = public as $$
declare c public.classes;
begin
  select * into c from classes where id = p_class and teacher_id = require_user();
  if not found then raise exception 'not your class' using errcode = '42501'; end if;
  return c;
end $$;
revoke execute on function public.require_own_class(uuid) from public, anon, authenticated;

create or replace function public.item_in_course(p_item text, p_course text) returns boolean
language sql immutable as $$
  select case when p_course = 'money' then p_item !~ ':' else left(p_item, length(p_course) + 1) = p_course || ':' end
$$;

-- Become a teacher. Tools work straight away; school and college email addresses are verified automatically.
create or replace function public.become_teacher(p_name text, p_school text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  mail text;
  host text;
  ok boolean;
begin
  select lower(email) into mail from auth.users where id = uid and (email_confirmed_at is not null or confirmed_at is not null);
  host := split_part(coalesce(mail, ''), '@', 2);
  ok := host like '%.sch.uk' or host like '%.ac.uk'
        or exists (select 1 from teacher_domains d where host = d.domain or host like '%.' || d.domain);
  insert into teachers (user_id, display_name, school, status, verified_at)
  values (uid, btrim(p_name), nullif(btrim(p_school), ''), case when ok then 'verified' else 'unverified' end, case when ok then now() end)
  on conflict (user_id) do update set display_name = excluded.display_name, school = excluded.school,
    status = case when teachers.status = 'verified' then 'verified' else excluded.status end,
    verified_at = coalesce(teachers.verified_at, excluded.verified_at);
  return (select status from teachers where user_id = uid);
end $$;

create or replace function public.create_class(p_name text, p_course text, p_year text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  new_id uuid;
  tries int := 0;
begin
  if not exists (select 1 from teachers where user_id = uid) then raise exception 'not a teacher' using errcode = '42501'; end if;
  if (select count(*) from classes where teacher_id = uid) >= 30 then raise exception 'too many classes' using errcode = 'CN107'; end if;
  loop
    begin
      insert into classes (teacher_id, name, course, year_group, join_code)
      values (uid, btrim(p_name), p_course, nullif(btrim(p_year), ''), new_join_code()) returning id into new_id;
      return new_id;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise; end if;
    end;
  end loop;
end $$;

create or replace function public.update_class(p_class uuid, p_name text, p_joining_open boolean, p_leaderboard_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_own_class(p_class);
  update classes set name = btrim(p_name), joining_open = p_joining_open, leaderboard_on = p_leaderboard_on where id = p_class;
end $$;

create or replace function public.renew_join_code(p_class uuid) returns text
language plpgsql security definer set search_path = public as $$
declare code text;
begin
  perform require_own_class(p_class);
  update classes set join_code = new_join_code() where id = p_class returning join_code into code;
  return code;
end $$;

create or replace function public.delete_class(p_class uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_own_class(p_class);
  delete from classes where id = p_class;
end $$;

create or replace function public.teacher_classes()
returns table (id uuid, name text, course text, year_group text, join_code text, joining_open boolean, leaderboard_on boolean, students bigint)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.course, c.year_group, c.join_code, c.joining_open, c.leaderboard_on,
         (select count(*) from class_members m where m.class_id = c.id and m.left_at is null)
  from classes c where c.teacher_id = require_user() order by c.created_at
$$;

-- What the consent screen shows. Needs the right code, and gives away nothing about who is in the class.
create or replace function public.class_preview(p_code text)
returns table (name text, teacher text, school text, course text, year_group text, joining_open boolean, already boolean)
language sql stable security definer set search_path = public as $$
  select c.name, t.display_name, t.school, c.course, c.year_group, c.joining_open,
         exists (select 1 from class_members m where m.class_id = c.id and m.user_id = require_user() and m.left_at is null)
  from classes c join teachers t on t.user_id = c.teacher_id
  where c.join_code = upper(btrim(p_code))
$$;

create or replace function public.join_class(p_code text, p_real_name text, p_consent boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  c public.classes;
  cap int;
  active boolean;
begin
  if p_consent is not true then raise exception 'consent needed' using errcode = 'CN106'; end if;
  if not exists (select 1 from profiles where user_id = uid) then raise exception 'pick a nickname first' using errcode = 'CN108'; end if;
  select * into c from classes where join_code = upper(btrim(p_code)) for update; -- holds the class, so two joins can't both take the last place
  if not found then raise exception 'no such class' using errcode = 'CN105'; end if;
  if c.teacher_id = uid then raise exception 'this is your own class' using errcode = 'CN103'; end if;
  select left_at is null into active from class_members where class_id = c.id and user_id = uid;
  if active then return c.id; end if;
  if not c.joining_open then raise exception 'joining is closed' using errcode = 'CN101'; end if;
  cap := case when (select status from teachers where user_id = c.teacher_id) = 'verified' then 200 else 35 end;
  if (select count(*) from class_members where class_id = c.id and left_at is null) >= cap then
    raise exception 'class is full' using errcode = 'CN102';
  end if;
  begin
    -- Coming back counts as joining afresh: the teacher sees nothing from the time away.
    insert into class_members (class_id, user_id, real_name, consented_at, joined_at)
    values (c.id, uid, btrim(p_real_name), now(), now())
    on conflict (class_id, user_id) do update set real_name = excluded.real_name, consented_at = now(), joined_at = now(), left_at = null;
  exception when check_violation then
    raise exception 'name not allowed' using errcode = 'CN104';
  end;
  return c.id;
end $$;

create or replace function public.leave_class(p_class uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update class_members set left_at = now() where class_id = p_class and user_id = require_user() and left_at is null;
end $$;

create or replace function public.my_classes()
returns table (id uuid, name text, teacher text, course text, year_group text, leaderboard_on boolean, joined_at timestamptz, real_name text)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, t.display_name, c.course, c.year_group, c.leaderboard_on, m.joined_at, m.real_name
  from class_members m join classes c on c.id = m.class_id join teachers t on t.user_id = c.teacher_id
  where m.user_id = require_user() and m.left_at is null order by m.joined_at
$$;

-- The teacher's view of a class. Work counts only between joining and leaving, so nothing from before can be seen.
create or replace function public.class_roster(p_class uuid)
returns table (user_id uuid, real_name text, nickname text, joined_at timestamptz, left_at timestamptz, passed bigint, last_active timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare c public.classes := require_own_class(p_class);
begin
  return query
    select m.user_id, m.real_name, p.nickname, m.joined_at, m.left_at,
           (select count(distinct a.item_id) from attempts a
            where a.user_id = m.user_id and a.auto_passed and a.kind = 'quiz' and item_in_course(a.item_id, c.course)
              and a.received_at >= m.joined_at and (m.left_at is null or a.received_at <= m.left_at)),
           (select max(a.received_at) from attempts a
            where a.user_id = m.user_id and item_in_course(a.item_id, c.course)
              and a.received_at >= m.joined_at and (m.left_at is null or a.received_at <= m.left_at))
    from class_members m left join profiles p on p.user_id = m.user_id
    where m.class_id = p_class order by m.left_at nulls first, m.real_name;
end $$;

create or replace function public.remove_from_class(p_class uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_own_class(p_class);
  update class_members set left_at = now() where class_id = p_class and user_id = p_user and left_at is null;
end $$;

-- Replace an unsuitable nickname straight away, so it leaves the public leaderboard. The student then picks a new one.
create or replace function public.reset_nickname(p_class uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  tmp text;
begin
  perform require_own_class(p_class);
  if (select status from teachers where user_id = uid) <> 'verified' then raise exception 'verified teachers only' using errcode = '42501'; end if;
  if not exists (select 1 from class_members where class_id = p_class and user_id = p_user and left_at is null) then
    raise exception 'not in this class' using errcode = '42501';
  end if;
  -- Digits the nickname filter doesn't read as letters, so the placeholder can never be refused by it.
  tmp := 'Learner ' || translate(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), '0123456789abcdef', '2689268926892689');
  perform set_config('compound.nickname_reset', 'on', true);
  update profiles set nickname = tmp, nickname_must_change = true where user_id = p_user;
  perform set_config('compound.nickname_reset', 'off', true);
end $$;

-- Class leaderboard: nicknames only, and only XP from this course since joining. Off if the teacher turns it off.
create or replace function public.class_leaderboard(p_class uuid)
returns table (nickname text, xp int, pos bigint, is_me boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := require_user();
  c public.classes;
begin
  select * into c from classes where id = p_class;
  if not found or not (c.teacher_id = uid or (c.leaderboard_on and exists (
    select 1 from class_members m where m.class_id = p_class and m.user_id = uid and m.left_at is null
  ))) then raise exception 'not available' using errcode = '42501'; end if;
  return query
    with best as (
      select a.user_id, a.item_id, max(a.auto) as top, bool_or(a.auto_passed) as won, max(a.kind) as kind
      from attempts a join class_members m on m.user_id = a.user_id and m.class_id = p_class and m.left_at is null
      where a.kind <> 'recall' and a.received_at >= m.joined_at and item_in_course(a.item_id, c.course)
      group by a.user_id, a.item_id
    ), totals as (
      select m.user_id, coalesce(sum(b.top * 10 + case when b.won then (case when b.kind = 'checkpoint' then 150 else 50 end) else 0 end), 0)::int as x
      from class_members m left join best b on b.user_id = m.user_id
      where m.class_id = p_class and m.left_at is null group by m.user_id
    )
    select p.nickname, t.x, rank() over (order by t.x desc), t.user_id = uid
    from totals t join profiles p on p.user_id = t.user_id order by t.x desc, p.nickname;
end $$;

-- ---------- P4b: a teacher's lesson order. Null means the class follows the course order. ----------
-- These only shape what a learner is shown next. Lessons are public files, so this is teaching, not security.
alter table public.classes add column if not exists unit_order text[];
alter table public.classes add column if not exists held_units text[];

create or replace function public.set_class_plan(p_class uuid, p_order text[], p_held text[]) returns void
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  perform require_own_class(p_class);
  if coalesce(array_length(p_order, 1), 0) > 40 or coalesce(array_length(p_held, 1), 0) > 40 then raise exception 'too many topics' using errcode = '22023'; end if;
  foreach k in array coalesce(p_order, '{}') || coalesce(p_held, '{}') loop
    if k !~ '^[a-z0-9._-]{1,30}$' then raise exception 'bad topic' using errcode = '22023'; end if;
  end loop;
  update classes set unit_order = p_order, held_units = case when p_order is null then null else coalesce(p_held, '{}') end where id = p_class;
end $$;

create or replace function public.class_plan(p_class uuid) returns table (unit_order text[], held_units text[])
language plpgsql stable security definer set search_path = public as $$
declare c public.classes := require_own_class(p_class);
begin
  return query select c.unit_order, c.held_units;
end $$;

create or replace function public.my_class_plans() returns table (course text, unit_order text[], held_units text[])
language sql stable security definer set search_path = public as $$
  select c.course, c.unit_order, c.held_units
  from class_members m join classes c on c.id = m.class_id
  where m.user_id = require_user() and m.left_at is null and c.unit_order is not null order by m.joined_at
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'become_teacher(text, text)', 'create_class(text, text, text)', 'update_class(uuid, text, boolean, boolean)',
    'renew_join_code(uuid)', 'delete_class(uuid)', 'teacher_classes()', 'class_preview(text)', 'join_class(text, text, boolean)',
    'leave_class(uuid)', 'my_classes()', 'class_roster(uuid)', 'remove_from_class(uuid, uuid)', 'reset_nickname(uuid, uuid)',
    'class_leaderboard(uuid)', 'set_class_plan(uuid, text[], text[])', 'class_plan(uuid)', 'my_class_plans()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
