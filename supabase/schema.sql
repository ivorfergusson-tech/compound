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

-- ---------- P5: assignments ----------
-- Privacy model: as with classes, nothing here can be read or written directly; every call goes through a function
-- below. When a teacher sets work, each question is frozen here with its answer (assignment_items.q), so later course
-- edits don't change it. Students only ever get q_public(), and marking happens here, so a browser can't forge a mark.
-- Questions from the public bank can still be looked up in the site's files; only marks are protected, not the answers.
create table if not exists public.assignments (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid not null references public.classes (id) on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 80),
  note         text check (length(note) <= 1000),
  open_at      timestamptz not null default now(),
  due_at       timestamptz,
  max_attempts int not null default 1 check (max_attempts between 1 and 10),
  minutes      int check (minutes between 1 and 300),
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  check (due_at is null or due_at > open_at)
);
create index if not exists assignments_class on public.assignments (class_id);

create table if not exists public.assignment_items (
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  position      int not null,
  kind          text not null check (kind in ('question', 'lesson')),
  item_id       text not null check (length(item_id) <= 120), -- a question id, or a lesson's progress key
  q             jsonb not null,                               -- the frozen question, or { title } for a lesson
  marks         int not null default 0 check (marks between 0 and 50),
  primary key (assignment_id, position)
);

create table if not exists public.submissions (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references public.assignments (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  attempt        int not null,
  started_at     timestamptz not null default now(),
  deadline       timestamptz,
  submitted_at   timestamptz,
  auto_submitted boolean not null default false,
  marks          int,
  out_of         int,
  unique (assignment_id, user_id, attempt)
);
create unique index if not exists submissions_one_open on public.submissions (assignment_id, user_id) where submitted_at is null;
create index if not exists submissions_user on public.submissions (user_id);

create table if not exists public.answers (
  submission_id uuid not null references public.submissions (id) on delete cascade,
  position      int not null,
  response      jsonb,
  marks         int,          -- the server's mark
  teacher_marks int,          -- replaces it when set
  teacher_note  text check (length(teacher_note) <= 500),
  updated_at    timestamptz not null default now(),
  primary key (submission_id, position)
);

alter table public.assignments enable row level security;
alter table public.assignment_items enable row level security;
alter table public.submissions enable row level security;
alter table public.answers enable row level security;

-- ---------- marking: must give the same marks as js/marking.js and mark() in js/quiz.js ----------
-- tools/classes_sql_test.mjs runs every question and test answer in the bank through both.
create or replace function public.mk_normalise(t text) returns text
language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(t, '')),
    '[’'']', '', 'g'), '[^a-z0-9£%.*\s-]', ' ', 'g'), '(\D)\.|\.(\D)', '\1 \2', 'g'), '\s+', ' ', 'g'))
$$;

create or replace function public.mk_tokens(t text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(w), '{}') from unnest(string_to_array(public.mk_normalise(t), ' ')) w where w <> ''
$$;

create or replace function public.mk_stem(w text) returns text
language plpgsql immutable as $$
declare e text;
begin
  foreach e in array array['ing', 'ed', 'es', 's'] loop
    if length(w) - length(e) >= 4 and right(w, length(e)) = e then return left(w, length(w) - length(e)); end if;
  end loop;
  return w;
end $$;

-- Damerau-Levenshtein (optimal string alignment), kept in rows of a flat array.
create or replace function public.mk_distance(a text, b text) returns int
language plpgsql immutable as $$
declare
  la int := length(a);
  lb int := length(b);
  w int := lb + 1;
  d int[] := array_fill(0, array[(la + 1) * w]);
  i int; j int; v int;
begin
  for i in 0..la loop d[i * w + 1] := i; end loop;
  for j in 0..lb loop d[j + 1] := j; end loop;
  for i in 1..la loop
    for j in 1..lb loop
      v := least(d[(i - 1) * w + j + 1] + 1, d[i * w + j] + 1,
                 d[(i - 1) * w + j] + case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end);
      if i > 1 and j > 1 and substr(a, i, 1) = substr(b, j - 1, 1) and substr(a, i - 1, 1) = substr(b, j, 1) then
        v := least(v, d[(i - 2) * w + j - 1] + 1);
      end if;
      d[i * w + j + 1] := v;
    end loop;
  end loop;
  return d[la * w + lb + 1];
end $$;

create or replace function public.mk_allowed(w text) returns int
language sql immutable as $$ select case when length(w) >= 8 then 2 when length(w) >= 5 then 1 else 0 end $$;

create or replace function public.mk_word(a text, p text) returns boolean
language plpgsql immutable as $$
declare
  sa text; sp text; n int;
begin
  if right(p, 1) = '*' then return left(a, length(p) - 1) = left(p, -1); end if;
  sa := public.mk_stem(a); sp := public.mk_stem(p);
  if sa = sp then return true; end if;
  if sp ~ '\d' then return false; end if;
  n := public.mk_allowed(sp);
  if n > 0 and abs(length(sa) - length(sp)) <= n and public.mk_distance(sa, sp) <= n then return true; end if;
  n := public.mk_allowed(p);
  return n > 0 and abs(length(a) - length(p)) <= n and public.mk_distance(a, p) <= n;
end $$;

create or replace function public.mk_phrase(ans text[], phrase text) returns boolean
language plpgsql immutable as $$
declare
  p text[] := public.mk_tokens(phrase);
  np int := coalesce(array_length(p, 1), 0);
  na int := coalesce(array_length(ans, 1), 0);
  i int; k int; hit boolean;
begin
  if np = 0 then return false; end if;
  for i in 1..(na - np + 1) loop
    hit := true;
    for k in 1..np loop
      if not public.mk_word(ans[i + k - 1], p[k]) then hit := false; exit; end if;
    end loop;
    if hit and not coalesce(ans[greatest(i - 2, 1):i - 1] && array['not', 'no', 'never', 'dont', 'doesnt', 'isnt', 'wont', 'cant', 'without'], false) then
      return true;
    end if;
  end loop;
  return false;
end $$;

create or replace function public.mk_explain(answer text, ideas jsonb) returns int
language plpgsql immutable as $$
declare
  t text[] := public.mk_tokens(left(answer, 2000));
  idea jsonb; ph text; n int := 0;
begin
  for idea in select * from jsonb_array_elements(ideas) loop
    for ph in select * from jsonb_array_elements_text(idea->'any') loop
      if public.mk_phrase(t, ph) then n := n + 1; exit; end if;
    end loop;
  end loop;
  return n;
end $$;

create or replace function public.mk_number(s text) returns numeric
language sql immutable as $$
  select replace((regexp_match(replace(translate(coalesce(s, ''), '−–—', '---'), ',', ''), '-?\s*\d*\.?\d+'))[1], ' ', '')::numeric
$$;

-- q is a frozen question; r is the saved response: mcq an index, tf a boolean, number or explain text,
-- order a list, match { left: right }. Anything else scores nothing.
create or replace function public.mark_item(q jsonb, r jsonb) returns int
language plpgsql immutable as $$
declare
  full_marks int := coalesce((q->>'marks')::int, 1);
  right_answer boolean := false;
  n numeric;
begin
  if r is null or jsonb_typeof(r) = 'null' then return 0; end if;
  case q->>'type'
    when 'mcq', 'tf' then right_answer := r = q->'answer';
    when 'number' then
      if jsonb_typeof(r) not in ('string', 'number') then return 0; end if;
      n := public.mk_number(r #>> '{}');
      right_answer := n is not null and abs(n - (q->>'answerValue')::numeric) <= coalesce((q->>'tol')::numeric, 0.01) + 0.000000001;
    when 'order' then right_answer := r = q->'items';
    when 'match' then
      if jsonb_typeof(r) <> 'object' then return 0; end if;
      right_answer := not exists (select 1 from jsonb_array_elements(q->'pairs') p where (r->>(p->>0)) is distinct from (p->>1));
    when 'explain' then
      if jsonb_typeof(r) <> 'string' then return 0; end if;
      return public.mk_explain(r #>> '{}', q->'ideas');
    when 'long' then return null; -- a written answer waits for the teacher
    else return 0;
  end case;
  return case when right_answer then full_marks else 0 end;
end $$;

-- What a student may see before marks are released. A list of allowed fields, so nothing new can leak by accident.
create or replace function public.q_public(q jsonb) returns jsonb
language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('type', q->'type', 'text', q->'text', 'marks', q->'marks', 'options', q->'options',
    'unit', q->'unit', 'shown', q->'shown', 'rightShown', q->'rightShown', 'links', q->'links',
    'pairs', case when q ? 'pairs' then (select jsonb_agg(jsonb_build_array(p->0)) from jsonb_array_elements(q->'pairs') p) end))
$$;

create or replace function public.q_ok(q jsonb) returns boolean
language plpgsql immutable as $$
begin
  if jsonb_typeof(q) is distinct from 'object' or jsonb_typeof(q->'text') is distinct from 'string' then return false; end if;
  case q->>'type'
    when 'mcq' then return jsonb_typeof(q->'options') = 'array' and jsonb_typeof(q->'answer') = 'number';
    when 'tf' then return jsonb_typeof(q->'answer') = 'boolean';
    when 'number' then return jsonb_typeof(q->'answerValue') = 'number';
    when 'order' then return jsonb_typeof(q->'items') = 'array' and jsonb_typeof(q->'shown') = 'array';
    when 'match' then return jsonb_typeof(q->'pairs') = 'array' and jsonb_typeof(q->'rightShown') = 'array';
    when 'explain' then return jsonb_typeof(q->'ideas') = 'array' and jsonb_array_length(q->'ideas') > 0;
    when 'long' then return true;
    else return false;
  end case;
end $$;

-- ---------- closing an attempt ----------
create or replace function public.finish_submission(p_sub uuid, p_at timestamptz, p_auto boolean) returns void
language plpgsql security definer set search_path = public as $$
declare a uuid;
begin
  select assignment_id into a from submissions where id = p_sub and submitted_at is null;
  if not found then return; end if;
  insert into answers (submission_id, position)
    select p_sub, i.position from assignment_items i where i.assignment_id = a and i.kind = 'question'
    on conflict do nothing;
  update answers x set marks = case when i.q->>'type' = 'long' and to_regclass('public.answer_photos') is not null
                                      and photo_count(p_sub, x.position) > 0 then null else mark_item(i.q, x.response) end
    from assignment_items i where x.submission_id = p_sub and i.assignment_id = a and i.position = x.position;
  update submissions s set submitted_at = p_at, auto_submitted = p_auto,
    marks = (select coalesce(sum(x.marks), 0) from answers x where x.submission_id = p_sub),
    out_of = (select coalesce(sum(i.marks), 0) from assignment_items i where i.assignment_id = a and i.kind = 'question')
  where s.id = p_sub;
end $$;

-- A timed attempt nobody handed in is closed at its deadline the next time anyone looks. 30 seconds' grace covers the last save.
create or replace function public.close_expired(p_assignment uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id, deadline from submissions
           where submitted_at is null and deadline < now() - interval '30 seconds'
             and (p_assignment is null or assignment_id = p_assignment) and (p_user is null or user_id = p_user)
  loop
    perform finish_submission(r.id, r.deadline, true);
  end loop;
end $$;

-- The student's own unfinished attempt, while they're still in the class and the work is still set.
create or replace function public.require_open_sub(p_sub uuid) returns public.submissions
language plpgsql security definer set search_path = public as $$
declare s public.submissions;
begin
  select x.* into s from submissions x
    join assignments a on a.id = x.assignment_id and a.archived_at is null
    join class_members m on m.class_id = a.class_id and m.user_id = x.user_id and m.left_at is null
    where x.id = p_sub and x.user_id = require_user() and x.submitted_at is null
    for update of x;
  if not found then raise exception 'not an open attempt' using errcode = 'CN201'; end if;
  return s;
end $$;

-- The class's teacher, and only for work done while the student was in the class.
create or replace function public.require_own_sub(p_sub uuid) returns public.submissions
language plpgsql stable security definer set search_path = public as $$
declare s public.submissions;
begin
  select x.* into s from submissions x
    join assignments a on a.id = x.assignment_id
    join classes c on c.id = a.class_id and c.teacher_id = require_user()
    join class_members m on m.class_id = a.class_id and m.user_id = x.user_id
    where x.id = p_sub and x.started_at >= m.joined_at and (m.left_at is null or x.started_at <= m.left_at);
  if not found then raise exception 'not your student''s work' using errcode = '42501'; end if;
  return s;
end $$;

-- ---------- teachers ----------
create or replace function public.create_assignment(p_class uuid, p_title text, p_note text, p_open timestamptz, p_due timestamptz,
                                                     p_attempts int, p_minutes int, p_items jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c public.classes := require_own_class(p_class);
  a uuid;
  it jsonb;
  pos int := 0;
  m int;
  n int := jsonb_array_length(p_items);
begin
  if n < 1 or n > 100 then raise exception 'pick 1 to 100 items' using errcode = 'CN202'; end if;
  if octet_length(p_items::text) > 1000000 then raise exception 'too large' using errcode = 'CN202'; end if;
  if (select count(*) from assignments where class_id = p_class) >= 500 then raise exception 'too many assignments' using errcode = 'CN203'; end if;
  insert into assignments (class_id, title, note, open_at, due_at, max_attempts, minutes)
    values (p_class, btrim(p_title), nullif(btrim(p_note), ''), coalesce(p_open, now()), p_due, p_attempts, p_minutes) returning id into a;
  for it in select * from jsonb_array_elements(p_items) loop
    pos := pos + 1;
    if it->>'kind' = 'lesson' then
      if not item_in_course(it->>'id', c.course) or not exists (select 1 from known_items k where k.item_id = it->>'id') then
        raise exception 'unknown lesson' using errcode = 'CN202';
      end if;
      insert into assignment_items (assignment_id, position, kind, item_id, q)
        values (a, pos, 'lesson', it->>'id', jsonb_build_object('title', left(it->>'title', 120)));
    else
      if it->>'kind' is distinct from 'question' or not coalesce(q_ok(it->'q'), false) then raise exception 'bad question' using errcode = 'CN202'; end if;
      -- An explain question is worth one mark for each idea, the same as the browser's marking.
      m := case when it->'q'->>'type' = 'explain' then jsonb_array_length(it->'q'->'ideas') else coalesce((it->'q'->>'marks')::int, 1) end;
      insert into assignment_items (assignment_id, position, kind, item_id, q, marks)
        values (a, pos, 'question', left(it->>'id', 120), jsonb_set(it->'q', '{marks}', to_jsonb(m)), m);
    end if;
  end loop;
  return a;
end $$;

create or replace function public.archive_assignment(p_assignment uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update assignments a set archived_at = now() from classes c
    where a.id = p_assignment and c.id = a.class_id and c.teacher_id = require_user() and a.archived_at is null;
end $$;

create or replace function public.class_assignments(p_class uuid)
returns table (id uuid, title text, open_at timestamptz, due_at timestamptz, max_attempts int, minutes int,
               questions bigint, lessons bigint, out_of bigint, started bigint, submitted bigint)
language plpgsql stable security definer set search_path = public as $$
declare c public.classes := require_own_class(p_class);
begin
  return query
    select a.id, a.title, a.open_at, a.due_at, a.max_attempts, a.minutes,
      (select count(*) from assignment_items i where i.assignment_id = a.id and i.kind = 'question'),
      (select count(*) from assignment_items i where i.assignment_id = a.id and i.kind = 'lesson'),
      (select coalesce(sum(i.marks), 0)::bigint from assignment_items i where i.assignment_id = a.id),
      (select count(distinct s.user_id) from submissions s join class_members m on m.class_id = c.id and m.user_id = s.user_id
        where s.assignment_id = a.id and m.left_at is null and s.started_at >= m.joined_at),
      (select count(distinct s.user_id) from submissions s join class_members m on m.class_id = c.id and m.user_id = s.user_id
        where s.assignment_id = a.id and m.left_at is null and s.started_at >= m.joined_at and s.submitted_at is not null)
    from assignments a where a.class_id = c.id and a.archived_at is null order by coalesce(a.due_at, a.open_at) desc;
end $$;

-- One row per student. Facts only: js/assign.js turns them into "late", "overdue" and so on.
drop function if exists public.assignment_overview(uuid);
create or replace function public.assignment_overview(p_assignment uuid)
returns table (user_id uuid, real_name text, left_at timestamptz, attempts bigint, in_progress boolean, best_sub uuid,
               best_marks int, out_of int, first_submitted timestamptz, auto_submitted boolean, lessons_done bigint, lessons_at timestamptz, to_mark bigint, started_at timestamptz, seconds bigint)
language plpgsql security definer set search_path = public as $$
declare a public.assignments; c public.classes;
begin
  select * into a from assignments x where x.id = p_assignment;
  c := require_own_class(a.class_id);
  perform close_expired(p_assignment, null);
  return query
    select m.user_id, m.real_name, m.left_at,
      (select count(*) from submissions s where s.assignment_id = a.id and s.user_id = m.user_id and s.started_at >= m.joined_at and (m.left_at is null or s.started_at <= m.left_at)),
      exists (select 1 from submissions s where s.assignment_id = a.id and s.user_id = m.user_id and s.submitted_at is null and s.started_at >= m.joined_at and (m.left_at is null or s.started_at <= m.left_at)),
      b.id, b.marks, b.out_of,
      (select min(s.submitted_at) from submissions s where s.assignment_id = a.id and s.user_id = m.user_id and s.started_at >= m.joined_at and (m.left_at is null or s.started_at <= m.left_at)),
      b.auto_submitted, l.done, l.finished,
      (select count(*) from answers x where x.submission_id = b.id and x.marks is null and x.teacher_marks is null),
      (select min(s.started_at) from submissions s where s.assignment_id = a.id and s.user_id = m.user_id and s.started_at >= m.joined_at and (m.left_at is null or s.started_at <= m.left_at)),
      (select coalesce(sum(s.active_seconds), 0)::bigint from submissions s where s.assignment_id = a.id and s.user_id = m.user_id and s.started_at >= m.joined_at and (m.left_at is null or s.started_at <= m.left_at))
    from class_members m
    left join lateral (select s.* from submissions s where s.assignment_id = a.id and s.user_id = m.user_id and s.submitted_at is not null
                         and s.started_at >= m.joined_at and (m.left_at is null or s.started_at <= m.left_at)
                       order by s.marks desc, s.submitted_at limit 1) b on true
    left join lateral (select count(*) as done, max(p.first_pass) as finished from (
        select min(t.received_at) as first_pass from attempts t join assignment_items i on i.item_id = t.item_id
        where i.assignment_id = a.id and i.kind = 'lesson' and t.user_id = m.user_id and t.kind = 'quiz' and t.passed
          and t.received_at >= m.joined_at and (m.left_at is null or t.received_at <= m.left_at)
        group by t.item_id) p) l on true
    where m.class_id = c.id order by m.left_at nulls first, m.real_name;
end $$;

create or replace function public.submission_detail(p_sub uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.submissions := require_own_sub(p_sub);
begin
  return jsonb_build_object('id', s.id, 'attempt', s.attempt, 'started_at', s.started_at, 'submitted_at', s.submitted_at, 'marks', s.marks, 'out_of', s.out_of,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('position', i.position, 'marks', i.marks, 'text', i.q->'text', 'correct', i.q->'correctText', 'why', i.q->'whyText', 'scheme', i.q->'scheme',
                'type', i.q->'type', 'options', i.q->'options', 'response', x.response, 'auto', x.marks, 'teacher_marks', x.teacher_marks, 'teacher_note', x.teacher_note, 'ai', ai_for(s.id, i.position), 'photos', photos_for(s.id, i.position)) order by i.position), '[]')
              from assignment_items i left join answers x on x.submission_id = s.id and x.position = i.position
              where i.assignment_id = s.assignment_id and i.kind = 'question'));
end $$;

-- The teacher's mark is final. A null mark goes back to the server's.
create or replace function public.set_answer_mark(p_sub uuid, p_position int, p_marks int, p_note text) returns int
language plpgsql security definer set search_path = public as $$
declare
  s public.submissions := require_own_sub(p_sub);
  top int;
  total int;
begin
  if s.submitted_at is null then raise exception 'not handed in yet' using errcode = 'CN204'; end if;
  select marks into top from assignment_items where assignment_id = s.assignment_id and position = p_position and kind = 'question';
  if not found or p_marks < 0 or p_marks > top then raise exception 'mark out of range' using errcode = 'CN205'; end if;
  update answers set teacher_marks = p_marks, teacher_note = nullif(btrim(p_note), ''), updated_at = now() where submission_id = p_sub and position = p_position;
  select coalesce(sum(coalesce(teacher_marks, marks)), 0) into total from answers where submission_id = p_sub;
  update submissions set marks = total where id = p_sub;
  return total;
end $$;

-- ---------- a teacher's own questions ----------
-- Private to the teacher. Stored ready to set, in the frozen format; setting one copies it, so editing or
-- deleting it later doesn't change work already set.
create table if not exists public.teacher_questions (
  id         uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users (id) on delete cascade,
  course     text not null check (course ~ '^[a-z0-9-]{2,30}$'),
  q          jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists teacher_questions_teacher on public.teacher_questions (teacher_id, course);
alter table public.teacher_questions enable row level security;

create or replace function public.save_teacher_question(p_id uuid, p_course text, p_q jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  m int := coalesce((p_q->>'marks')::int, 0);
  r uuid;
begin
  if not exists (select 1 from teachers where user_id = uid) then raise exception 'teachers only' using errcode = '42501'; end if;
  if not coalesce(q_ok(p_q), false) or p_q->>'type' = 'explain' or m not between 1 and 50 or length(p_q->>'text') > 4000 or octet_length(p_q::text) > 20000 then
    raise exception 'bad question' using errcode = 'CN202';
  end if;
  if (select count(*) from teacher_questions where teacher_id = uid) >= 2000 then raise exception 'too many questions' using errcode = 'CN208'; end if;
  if p_id is null then
    insert into teacher_questions (teacher_id, course, q) values (uid, p_course, p_q) returning id into r;
  else
    update teacher_questions set q = p_q where id = p_id and teacher_id = uid returning id into r;
    if not found then raise exception 'not your question' using errcode = '42501'; end if;
  end if;
  return r;
end $$;

create or replace function public.my_teacher_questions(p_course text) returns table (id uuid, q jsonb)
language sql stable security definer set search_path = public as $$
  select t.id, t.q from teacher_questions t where t.teacher_id = require_user() and t.course = p_course order by t.created_at desc
$$;

create or replace function public.delete_teacher_question(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from teacher_questions where id = p_id and teacher_id = require_user();
end $$;

-- ---------- students ----------
create or replace function public.my_assignments()
returns table (id uuid, class_id uuid, class_name text, title text, note text, open_at timestamptz, due_at timestamptz, max_attempts int, minutes int,
               questions bigint, out_of bigint, lessons jsonb, attempts bigint, open_sub uuid, best_sub uuid, best_marks int, first_submitted timestamptz)
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  perform close_expired(null, uid);
  return query
    select a.id, c.id, c.name, a.title, a.note, a.open_at, a.due_at, a.max_attempts, a.minutes,
      (select count(*) from assignment_items i where i.assignment_id = a.id and i.kind = 'question'),
      (select coalesce(sum(i.marks), 0)::bigint from assignment_items i where i.assignment_id = a.id),
      (select coalesce(jsonb_agg(jsonb_build_object('id', i.item_id, 'title', i.q->'title',
                'done', exists (select 1 from attempts t where t.user_id = uid and t.item_id = i.item_id and t.kind = 'quiz' and t.passed and t.received_at >= m.joined_at)) order by i.position), '[]')
         from assignment_items i where i.assignment_id = a.id and i.kind = 'lesson'),
      (select count(*) from submissions s where s.assignment_id = a.id and s.user_id = uid),
      (select s.id from submissions s where s.assignment_id = a.id and s.user_id = uid and s.submitted_at is null),
      b.id, b.marks,
      (select min(s.submitted_at) from submissions s where s.assignment_id = a.id and s.user_id = uid)
    from class_members m
    join classes c on c.id = m.class_id
    join assignments a on a.class_id = c.id and a.archived_at is null and a.open_at <= now()
    left join lateral (select s.id, s.marks from submissions s where s.assignment_id = a.id and s.user_id = uid and s.submitted_at is not null
                       order by s.marks desc, s.submitted_at limit 1) b on true
    where m.user_id = uid and m.left_at is null order by a.due_at nulls last, a.open_at;
end $$;

-- Starts an attempt, or picks the open one up again, with the student's saved answers.
create or replace function public.start_attempt(p_assignment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  a public.assignments;
  s public.submissions;
  used int;
begin
  select x.* into a from assignments x join class_members m on m.class_id = x.class_id
    where x.id = p_assignment and m.user_id = uid and m.left_at is null and x.archived_at is null and x.open_at <= now()
    for update of m; -- holds this student's row, so two tabs can't start two attempts
  if not found then raise exception 'not set for you' using errcode = '42501'; end if;
  perform close_expired(p_assignment, uid);
  select * into s from submissions where assignment_id = a.id and user_id = uid and submitted_at is null;
  if not found then
    select count(*) into used from submissions where assignment_id = a.id and user_id = uid;
    if used >= a.max_attempts then raise exception 'no attempts left' using errcode = 'CN206'; end if;
    insert into submissions (assignment_id, user_id, attempt, deadline)
      values (a.id, uid, used + 1, case when a.minutes is not null then now() + make_interval(mins => a.minutes) end) returning * into s;
  end if;
  return jsonb_build_object('id', s.id, 'attempt', s.attempt, 'deadline', s.deadline, 'now', now(),
    'items', (select coalesce(jsonb_agg(q_public(i.q) || jsonb_build_object('position', i.position) order by i.position), '[]')
              from assignment_items i where i.assignment_id = a.id and i.kind = 'question'),
    'answers', (select coalesce(jsonb_object_agg(x.position::text, x.response), '{}') from answers x where x.submission_id = s.id),
    'photos', (select coalesce(jsonb_object_agg(i.position::text, photos_for(s.id, i.position)), '{}') from assignment_items i where i.assignment_id = a.id and i.q->>'type' = 'long'));
end $$;

-- p_answers is { "position": response }. A timed attempt past its deadline keeps what was saved in time, and says so.
create or replace function public.save_answers(p_sub uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.submissions := require_open_sub(p_sub);
begin
  if s.deadline < now() - interval '30 seconds' then
    perform finish_submission(s.id, s.deadline, true);
    return jsonb_build_object('closed', true);
  end if;
  if octet_length(p_answers::text) > 1000000 or exists (select 1 from jsonb_each(p_answers) e where octet_length(e.value::text) > 40000) then
    raise exception 'answer too long' using errcode = 'CN207';
  end if;
  insert into answers (submission_id, position, response)
    select s.id, i.position, e.value from jsonb_each(p_answers) e
    join assignment_items i on i.assignment_id = s.assignment_id and i.kind = 'question' and i.position::text = e.key
    on conflict (submission_id, position) do update set response = excluded.response, updated_at = now();
  return jsonb_build_object('closed', false, 'saved_at', now());
end $$;

create or replace function public.submit_attempt(p_sub uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := save_answers(p_sub, p_answers);
begin
  if not (r->>'closed')::boolean then perform finish_submission(p_sub, now(), false); end if;
  return (select jsonb_build_object('id', id, 'marks', marks, 'out_of', out_of) from submissions where id = p_sub);
end $$;

-- A student's marked work. Right answers wait until the due date (or, with no due date, until their attempts run out),
-- so they can't be passed round while others are still working.
create or replace function public.my_result(p_sub uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s public.submissions;
  a public.assignments;
  open_up boolean;
begin
  select * into s from submissions where id = p_sub and user_id = require_user() and submitted_at is not null;
  if not found then raise exception 'not your work' using errcode = '42501'; end if;
  select * into a from assignments where id = s.assignment_id;
  open_up := case when a.due_at is not null then now() >= a.due_at
                  else (select count(*) from submissions x where x.assignment_id = a.id and x.user_id = s.user_id and x.submitted_at is not null) >= a.max_attempts end;
  return jsonb_build_object('id', s.id, 'attempt', s.attempt, 'submitted_at', s.submitted_at, 'marks', s.marks, 'out_of', s.out_of,
    'title', a.title, 'due_at', a.due_at, 'released', open_up,
    'items', (select coalesce(jsonb_agg(q_public(i.q) || jsonb_build_object('position', i.position, 'response', x.response, 'got', coalesce(x.teacher_marks, x.marks),
                'teacher_note', x.teacher_note, 'ai', ai_for(s.id, i.position)) || case when open_up then jsonb_build_object('correct', i.q->'correctText', 'why', i.q->'whyText') else '{}'::jsonb end order by i.position), '[]')
              from assignment_items i left join answers x on x.submission_id = s.id and x.position = i.position
              where i.assignment_id = a.id and i.kind = 'question'));
end $$;

-- For "download my data": the work saved under this account.
create or replace function public.my_work_export() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('assignment', a.title, 'attempt', s.attempt, 'started_at', s.started_at, 'submitted_at', s.submitted_at, 'marks', s.marks, 'out_of', s.out_of,
    'answers', (select coalesce(jsonb_agg(jsonb_build_object('position', x.position, 'response', x.response, 'marks', coalesce(x.teacher_marks, x.marks), 'note', x.teacher_note)), '[]') from answers x where x.submission_id = s.id))), '[]')
  from submissions s join assignments a on a.id = s.assignment_id where s.user_id = require_user()
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'mk_normalise(text)', 'mk_tokens(text)', 'mk_stem(text)', 'mk_distance(text, text)', 'mk_allowed(text)', 'mk_word(text, text)', 'mk_phrase(text[], text)',
    'mk_explain(text, jsonb)', 'mk_number(text)', 'mark_item(jsonb, jsonb)', 'q_public(jsonb)', 'q_ok(jsonb)', 'finish_submission(uuid, timestamptz, boolean)',
    'close_expired(uuid, uuid)', 'require_open_sub(uuid)', 'require_own_sub(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'create_assignment(uuid, text, text, timestamptz, timestamptz, int, int, jsonb)', 'archive_assignment(uuid)', 'class_assignments(uuid)',
    'save_teacher_question(uuid, text, jsonb)', 'my_teacher_questions(text)', 'delete_teacher_question(uuid)',
    'assignment_overview(uuid)', 'submission_detail(uuid)', 'set_answer_mark(uuid, int, int, text)', 'my_assignments()', 'start_attempt(uuid)',
    'save_answers(uuid, jsonb)', 'submit_attempt(uuid, jsonb)', 'my_result(uuid)', 'my_work_export()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------- P6: AI marking ----------
-- AI marks are estimates and never change a total: the teacher's mark is the only one that counts. These functions are
-- for the mark-answer Edge Function alone (service role). They take the user id it has checked, and browsers can't call them.
create table if not exists public.ai_limits (
  id             int primary key default 1 check (id = 1),
  monthly_pence  int not null default 1000, -- the hard budget: £10 to start
  student_daily  int not null default 20    -- set work, per student
);
insert into public.ai_limits (id) values (1) on conflict do nothing;

create table if not exists public.ai_marks (
  submission_id uuid not null references public.submissions (id) on delete cascade,
  position      int not null,
  status        text not null default 'pending' check (status in ('pending', 'done')),
  level         int,
  marks         int,
  earned        text,
  missing       text,
  next_step     text,
  model         text,
  created_at    timestamptz not null default now(),
  primary key (submission_id, position)
);

-- Kept when work or an account is deleted (no link to either), as it's the spending record. It names nobody.
create table if not exists public.ai_usage (
  id         bigint generated always as identity primary key,
  student    uuid not null,
  input_tok  int not null,
  output_tok int not null,
  pence      numeric(10, 4) not null,
  model      text,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_student on public.ai_usage (student, created_at);

alter table public.ai_limits enable row level security;
alter table public.ai_marks enable row level security;
alter table public.ai_usage enable row level security;

-- Checks everything, then holds the answer so two calls can't both pay for it. A hold over 5 minutes old was a crash.
create or replace function public.ai_begin(p_user uuid, p_sub uuid, p_position int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.submissions;
  q jsonb;
  ans public.answers;
  top int;
  lim public.ai_limits;
  ins int;
begin
  select * into s from submissions where id = p_sub and submitted_at is not null;
  if not found or not (s.user_id = p_user or exists (
       select 1 from assignments a join classes c on c.id = a.class_id join class_members m on m.class_id = c.id and m.user_id = s.user_id
       where a.id = s.assignment_id and c.teacher_id = p_user and s.started_at >= m.joined_at and (m.left_at is null or s.started_at <= m.left_at))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select i.q, i.marks into q, top from assignment_items i where i.assignment_id = s.assignment_id and i.position = p_position and i.kind = 'question';
  if q->>'type' is distinct from 'long' or q ? 'links' then return jsonb_build_object('ok', false, 'reason', 'not_written'); end if;
  select * into ans from answers where submission_id = p_sub and position = p_position;
  if jsonb_typeof(ans.response) is distinct from 'string' then return jsonb_build_object('ok', false, 'reason', 'blank'); end if;
  if ans.teacher_marks is not null then return jsonb_build_object('ok', false, 'reason', 'teacher_marked'); end if;
  select * into lim from ai_limits;
  perform pg_advisory_xact_lock(hashtext('ai_budget')); -- one at a time, so the check and the hold can't race
  if (select coalesce(sum(pence), 0) from ai_usage where created_at >= date_trunc('month', now())) >= lim.monthly_pence then
    return jsonb_build_object('ok', false, 'reason', 'budget');
  end if;
  if (select count(*) from ai_usage where student = s.user_id and created_at >= date_trunc('day', now())) >= lim.student_daily then
    return jsonb_build_object('ok', false, 'reason', 'cap');
  end if;
  insert into ai_marks (submission_id, position) values (p_sub, p_position)
    on conflict (submission_id, position) do update set created_at = now()
    where ai_marks.status = 'pending' and ai_marks.created_at < now() - interval '5 minutes';
  get diagnostics ins = row_count;
  if ins = 0 then return jsonb_build_object('ok', false, 'reason', 'done'); end if;
  return jsonb_build_object('ok', true, 'marks', top, 'text', q->'text', 'scheme', q->'scheme', 'model_answer', q->'correctText', 'answer', ans.response);
end $$;

create or replace function public.ai_finish(p_sub uuid, p_position int, p_user uuid, p_mark jsonb, p_model text, p_input int, p_output int, p_pence numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  update ai_marks set status = 'done', level = (p_mark->>'level')::int, marks = (p_mark->>'marks')::int, earned = p_mark->>'earned', missing = p_mark->>'missing',
    next_step = p_mark->>'next_step', model = p_model where submission_id = p_sub and position = p_position;
  insert into ai_usage (student, input_tok, output_tok, pence, model)
    select user_id, p_input, p_output, p_pence, p_model from submissions where id = p_sub;
end $$;

create or replace function public.ai_fail(p_sub uuid, p_position int) returns void
language sql security definer set search_path = public as $$
  delete from ai_marks where submission_id = p_sub and position = p_position and status = 'pending'
$$;

create or replace function public.ai_for(p_sub uuid, p_position int) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('level', level, 'marks', marks, 'earned', earned, 'missing', missing, 'next_step', next_step)
  from ai_marks where submission_id = p_sub and position = p_position and status = 'done'
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'ai_begin(uuid, uuid, int)', 'ai_finish(uuid, int, uuid, jsonb, text, int, int, numeric)', 'ai_fail(uuid, int)', 'ai_for(uuid, int)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ---------- P6b: photo hand-in ----------
-- Photos sit in a private bucket at <user>/<submission>/<position>/<file>.jpg, readable only by the student and their
-- teacher. tools/purge_photos.py deletes them 90 days after marking. Files can only be deleted through the Storage API,
-- so deleting a row here puts its path in photo_trash for that tool to finish the job.
create table if not exists public.answer_photos (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  position      int not null,
  path          text not null unique,
  created_at    timestamptz not null default now()
);
create index if not exists answer_photos_sub on public.answer_photos (submission_id, position);
create table if not exists public.photo_trash (path text primary key);
alter table public.answer_photos enable row level security;
alter table public.photo_trash enable row level security;

create or replace function public.photo_to_trash() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into photo_trash (path) values (old.path) on conflict do nothing;
  return old;
end $$;
revoke execute on function public.photo_to_trash() from public, anon, authenticated;
drop trigger if exists answer_photos_trash on public.answer_photos;
create trigger answer_photos_trash after delete on public.answer_photos for each row execute function public.photo_to_trash();

-- Used by the storage rules below. An upload must be into the student's own open attempt, on a written question.
create or replace function public.can_upload_photo(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  m text[] := regexp_match(p_name, '^([0-9a-f-]{36})/([0-9a-f-]{36})/([0-9]{1,3})/[0-9a-f-]{36}\.jpg$');
begin
  if m is null or m[1] is distinct from auth.uid()::text then return false; end if;
  return exists (select 1 from submissions s
    join assignments a on a.id = s.assignment_id and a.archived_at is null
    join class_members cm on cm.class_id = a.class_id and cm.user_id = s.user_id and cm.left_at is null
    join assignment_items i on i.assignment_id = a.id and i.position = m[3]::int and i.q->>'type' = 'long'
    where s.id = m[2]::uuid and s.user_id = auth.uid() and s.submitted_at is null and (s.deadline is null or s.deadline >= now()));
end $$;

create or replace function public.can_read_photo(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select split_part(p_name, '/', 1) = auth.uid()::text or exists (select 1 from answer_photos p
    join submissions s on s.id = p.submission_id
    join assignments a on a.id = s.assignment_id
    join classes c on c.id = a.class_id and c.teacher_id = auth.uid()
    join class_members m on m.class_id = c.id and m.user_id = s.user_id
    where p.path = p_name and s.started_at >= m.joined_at and (m.left_at is null or s.started_at <= m.left_at))
$$;

-- Hosted Supabase can refuse these from the SQL editor, as storage belongs to another role. One refusal mustn't undo the
-- whole file, so each step stands alone. Without the rules, uploads are simply refused. SETUP.md has the way to add them by hand.
do $$
begin
  if to_regclass('storage.objects') is null then return; end if;
  begin
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('handins', 'handins', false, 3000000, array['image/jpeg']) on conflict (id) do nothing;
  exception when insufficient_privilege then raise warning 'handins bucket not made: create it by hand';
  end;
  begin
    drop policy if exists "handins: upload own" on storage.objects;
    create policy "handins: upload own" on storage.objects for insert to authenticated
      with check (bucket_id = 'handins' and public.can_upload_photo(name));
    drop policy if exists "handins: student and teacher read" on storage.objects;
    create policy "handins: student and teacher read" on storage.objects for select to authenticated
      using (bucket_id = 'handins' and public.can_read_photo(name));
  exception when insufficient_privilege then raise warning 'handins storage rules not made: add them by hand';
  end;
end $$;

create or replace function public.add_photo(p_sub uuid, p_position int, p_path text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s public.submissions := require_open_sub(p_sub);
  r uuid;
begin
  if not can_upload_photo(p_path) or split_part(p_path, '/', 2) <> s.id::text or split_part(p_path, '/', 3) <> p_position::text then
    raise exception 'bad photo' using errcode = 'CN209';
  end if;
  if (select count(*) from answer_photos where submission_id = p_sub and position = p_position)
     >= (select case when i.q ? 'links' then 40 else 6 end from assignment_items i where i.assignment_id = s.assignment_id and i.position = p_position) then
    raise exception 'too many photos' using errcode = 'CN210';
  end if;
  insert into answer_photos (submission_id, position, path) values (p_sub, p_position, p_path) returning id into r;
  return r;
end $$;

create or replace function public.remove_photo(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s uuid;
begin
  select submission_id into s from answer_photos where id = p_id;
  perform require_open_sub(s);
  delete from answer_photos where id = p_id;
end $$;

create or replace function public.photo_count(p_sub uuid, p_position int) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from answer_photos where submission_id = p_sub and position = p_position
$$;
revoke execute on function public.photo_count(uuid, int) from public, anon, authenticated;

create or replace function public.photos_for(p_sub uuid, p_position int) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'path', path) order by created_at), '[]') from answer_photos where submission_id = p_sub and position = p_position
$$;

-- For the read-handwriting Edge Function only, with the same limits as AI marking.
create or replace function public.ai_read_begin(p_user uuid, p_sub uuid, p_position int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.submissions;
  lim public.ai_limits;
  paths jsonb;
begin
  select * into s from submissions where id = p_sub and user_id = p_user and submitted_at is null;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(path order by created_at), '[]') into paths from answer_photos where submission_id = p_sub and position = p_position;
  if exists (select 1 from assignment_items i where i.assignment_id = s.assignment_id and i.position = p_position and i.q ? 'links') then
    return jsonb_build_object('ok', false, 'reason', 'not_written');
  end if;
  if jsonb_array_length(paths) = 0 then return jsonb_build_object('ok', false, 'reason', 'no_photos'); end if;
  select * into lim from ai_limits;
  perform pg_advisory_xact_lock(hashtext('ai_budget'));
  if (select coalesce(sum(pence), 0) from ai_usage where created_at >= date_trunc('month', now())) >= lim.monthly_pence then
    return jsonb_build_object('ok', false, 'reason', 'budget');
  end if;
  if (select count(*) from ai_usage where student = p_user and created_at >= date_trunc('day', now())) >= lim.student_daily then
    return jsonb_build_object('ok', false, 'reason', 'cap');
  end if;
  return jsonb_build_object('ok', true, 'paths', paths);
end $$;

create or replace function public.ai_read_finish(p_sub uuid, p_model text, p_input int, p_output int, p_pence numeric) returns void
language sql security definer set search_path = public as $$
  insert into ai_usage (student, input_tok, output_tok, pence, model) select user_id, p_input, p_output, p_pence, p_model from submissions where id = p_sub
$$;

-- For tools/purge_photos.py only. Due: 90 days after the last teacher mark or hand-in, the trash, and any file with no
-- row after a day (an upload that was never registered).
create or replace function public.photos_expired() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out_paths text[];
begin
  select array_agg(path) into out_paths from (
    select p.path from answer_photos p join submissions s on s.id = p.submission_id
      where greatest(p.created_at, s.submitted_at, (select max(x.updated_at) from answers x where x.submission_id = s.id and x.teacher_marks is not null)) < now() - interval '90 days'
    union select path from photo_trash
  ) t;
  if to_regclass('storage.objects') is not null then
    out_paths := coalesce(out_paths, '{}') || array(select o.name from storage.objects o where o.bucket_id = 'handins' and o.created_at < now() - interval '1 day'
      and not exists (select 1 from answer_photos p where p.path = o.name) and not exists (select 1 from photo_trash t where t.path = o.name));
  end if;
  return coalesce(to_jsonb(out_paths), '[]');
end $$;

create or replace function public.photos_purged(p_paths text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from answer_photos where path = any (p_paths);
  delete from photo_trash where path = any (p_paths);
end $$;

do $$
declare f text;
begin
  foreach f in array array['ai_read_begin(uuid, uuid, int)', 'ai_read_finish(uuid, text, int, int, numeric)', 'photos_expired()', 'photos_purged(text[])'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  execute 'revoke execute on function public.photos_for(uuid, int) from public, anon, authenticated';
  foreach f in array array['add_photo(uuid, int, text)', 'remove_photo(uuid)', 'can_upload_photo(text)', 'can_read_photo(text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------- P7: analytics ----------
-- Everything here repeats the teacher's rule: only their own class, and only work started between joining and leaving.
-- Time is sent by the browser, so it's a guide. It can never add up to more than the real time since the last report.
alter table public.submissions add column if not exists active_seconds int not null default 0;
alter table public.submissions add column if not exists last_beat timestamptz;
alter table public.answers add column if not exists seconds int not null default 0;

-- p_seconds is { "position": seconds } since the last report.
create or replace function public.beat(p_sub uuid, p_seconds jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.submissions := require_open_sub(p_sub);
  room numeric := extract(epoch from now() - coalesce(s.last_beat, s.started_at)) + 5;
  sent numeric;
  k numeric;
begin
  select sum((e.value #>> '{}')::numeric) into sent from jsonb_each(p_seconds) e where jsonb_typeof(e.value) = 'number' and (e.value #>> '{}')::numeric > 0;
  if coalesce(sent, 0) <= 0 then return; end if;
  k := least(1, room / sent);
  insert into answers (submission_id, position, seconds)
    select s.id, i.position, floor((e.value #>> '{}')::numeric * k)::int from jsonb_each(p_seconds) e
    join assignment_items i on i.assignment_id = s.assignment_id and i.kind = 'question' and i.position::text = e.key
    where jsonb_typeof(e.value) = 'number' and (e.value #>> '{}')::numeric > 0
    on conflict (submission_id, position) do update set seconds = answers.seconds + excluded.seconds;
  update submissions set active_seconds = active_seconds + floor(sent * k)::int, last_beat = now() where id = s.id;
end $$;

-- Every marked answer the teacher may see. Internal: the functions below check the teacher first.
create or replace function public.class_answers(p_class uuid)
returns table (user_id uuid, real_name text, left_at timestamptz, assignment_id uuid, sub_id uuid, pos int, q jsonb, top int, got int, response jsonb, seconds int)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.real_name, m.left_at, a.id, s.id, i.position, i.q, i.marks, coalesce(x.teacher_marks, x.marks), x.response, x.seconds
  from class_members m
  join assignments a on a.class_id = m.class_id
  join submissions s on s.assignment_id = a.id and s.user_id = m.user_id and s.submitted_at is not null and s.started_at >= m.joined_at and (m.left_at is null or s.started_at <= m.left_at)
  join assignment_items i on i.assignment_id = a.id and i.kind = 'question'
  join answers x on x.submission_id = s.id and x.position = i.position
  where m.class_id = p_class
$$;
revoke execute on function public.class_answers(uuid) from public, anon, authenticated;

create or replace function public.class_heatmap(p_class uuid)
returns table (user_id uuid, real_name text, spec text, got bigint, out_of bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_own_class(p_class);
  return query
    select c.user_id, c.real_name, coalesce(c.q->>'spec', ''), sum(c.got)::bigint, sum(c.top)::bigint
    from class_answers(p_class) c where c.left_at is null and c.got is not null group by 1, 2, 3 order by 2, 3;
end $$;

-- Answers that aren't right, most common first. A wrong answer in another form counts apart, so it stays what was written.
create or replace function public.question_stats(p_assignment uuid)
returns table (item int, text jsonb, type text, options jsonb, top int, answered bigint, full_marks bigint, avg_seconds int, common_wrong jsonb, wrong_times bigint)
language plpgsql stable security definer set search_path = public as $$
declare a public.assignments;
begin
  select * into a from assignments x where x.id = p_assignment;
  perform require_own_class(a.class_id);
  return query
    with c as (select * from class_answers(a.class_id) where assignment_id = a.id)
    select i.position, i.q->'text', i.q->>'type', i.q->'options', i.marks,
      (select count(*) from c where c.pos = i.position and c.response is not null),
      (select count(*) from c where c.pos = i.position and c.got = i.marks),
      (select round(avg(c.seconds))::int from c where c.pos = i.position and c.seconds > 0),
      w.response, w.n
    from assignment_items i
    left join lateral (select c.response, count(*) as n from c where c.pos = i.position and c.response is not null and c.got is not null and c.got < i.marks
                       and i.q->>'type' <> 'long' group by c.response order by n desc, c.response::text limit 1) w on true
    where i.assignment_id = a.id and i.kind = 'question' order by i.position;
end $$;

create or replace function public.student_profile(p_class uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.classes := require_own_class(p_class);
  m public.class_members;
  streak int := 0;
  d date := current_date;
begin
  select * into m from class_members where class_id = p_class and user_id = p_user;
  if not found then raise exception 'not in this class' using errcode = '42501'; end if;
  if m.left_at is null then
    if not exists (select 1 from active_days where user_id = p_user and day = d) then d := d - 1; end if;
    while d >= m.joined_at::date and exists (select 1 from active_days where user_id = p_user and day = d) loop
      streak := streak + 1;
      d := d - 1;
    end loop;
  end if;
  return jsonb_build_object('real_name', m.real_name, 'joined_at', m.joined_at, 'left_at', m.left_at, 'streak', streak,
    'passed', (select count(distinct a.item_id) from attempts a where a.user_id = p_user and a.auto_passed and a.kind = 'quiz' and item_in_course(a.item_id, c.course)
               and a.received_at >= m.joined_at and (m.left_at is null or a.received_at <= m.left_at)),
    'last_active', (select max(a.received_at) from attempts a where a.user_id = p_user and item_in_course(a.item_id, c.course)
               and a.received_at >= m.joined_at and (m.left_at is null or a.received_at <= m.left_at)),
    'work', (select coalesce(jsonb_agg(jsonb_build_object('title', a.title, 'due_at', a.due_at, 'submitted_at', s.submitted_at, 'marks', s.marks, 'out_of', s.out_of,
               'attempt', s.attempt, 'seconds', s.active_seconds) order by s.submitted_at), '[]')
             from submissions s join assignments a on a.id = s.assignment_id
             where a.class_id = p_class and s.user_id = p_user and s.submitted_at is not null and s.started_at >= m.joined_at and (m.left_at is null or s.started_at <= m.left_at)),
    'papers', (select coalesce(jsonb_agg(jsonb_build_object('paper_id', a.paper_id, 'done_on', a.done_on, 'got', a.got, 'out_of', a.out_of, 'items', a.items) order by a.done_on), '[]')
               from paper_attempts a where a.user_id = p_user and a.course = c.course and a.created_at >= m.joined_at and (m.left_at is null or a.created_at <= m.left_at)),
    'topics', (select coalesce(jsonb_agg(jsonb_build_object('spec', t.spec, 'got', t.got, 'out_of', t.out_of)), '[]')
               from (select coalesce(x.q->>'spec', '') as spec, sum(x.got) as got, sum(x.top) as out_of from class_answers(p_class) x
                     where x.user_id = p_user and x.got is not null group by 1) t));
end $$;

-- One row per student and piece of work, for the CSV. js/teacher.js builds the file in the teacher's browser.
create or replace function public.class_marks(p_class uuid)
returns table (real_name text, left_at timestamptz, title text, due_at timestamptz, attempts bigint, best int, out_of int, first_submitted timestamptz, seconds bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_own_class(p_class);
  return query
    select m.real_name, m.left_at, a.title, a.due_at, count(s.id), max(s.marks), max(s.out_of), min(s.submitted_at), coalesce(sum(s.active_seconds), 0)::bigint
    from class_members m
    join assignments a on a.class_id = m.class_id and a.archived_at is null
    left join submissions s on s.assignment_id = a.id and s.user_id = m.user_id and s.submitted_at is not null and s.started_at >= m.joined_at and (m.left_at is null or s.started_at <= m.left_at)
    where m.class_id = p_class group by m.real_name, m.left_at, a.id, a.title, a.due_at, a.open_at order by m.real_name, a.open_at;
end $$;

do $$
declare f text;
begin
  foreach f in array array['beat(uuid, jsonb)', 'class_heatmap(uuid)', 'question_stats(uuid)', 'student_profile(uuid, uuid)', 'class_marks(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------- P8: past papers ----------
-- Paper marks are logged by the learner, so they're a guide. Papers themselves are never stored: only links, in papers.json.
create table if not exists public.paper_attempts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  course     text not null check (course ~ '^[a-z0-9-]{2,30}$'),
  paper_id   text not null check (paper_id ~ '^[A-Z0-9-]{3,20}$'),
  done_on    date not null,
  items      jsonb not null,
  got        int not null,
  out_of     int not null,
  cons_got   int not null default 0,
  cons_of    int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists paper_attempts_user on public.paper_attempts (user_id, course);
create table if not exists public.reserved_papers (
  class_id uuid not null references public.classes (id) on delete cascade,
  paper_id text not null check (paper_id ~ '^[A-Z0-9-]{3,20}$'),
  primary key (class_id, paper_id)
);
alter table public.paper_attempts enable row level security;
alter table public.reserved_papers enable row level security;

-- A whole paper is worth 80, and a teacher can set one as a single question.
alter table public.assignment_items drop constraint if exists assignment_items_marks_check;
alter table public.assignment_items add constraint assignment_items_marks_check check (marks between 0 and 120);

create or replace function public.log_paper(p_course text, p_paper text, p_done date, p_items jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  n int := jsonb_array_length(p_items);
  bad boolean;
  g int; o int; r uuid;
begin
  if n < 1 or n > 60 or p_done > current_date + 1 or p_done < date '2015-01-01' then raise exception 'bad log' using errcode = 'CN211'; end if;
  select bool_or(not coalesce((x->>'got') ~ '^\d{1,3}$' and (x->>'out_of') ~ '^\d{1,3}$' and (x->>'got')::int <= (x->>'out_of')::int and (x->>'out_of')::int between 1 and 50 and length(coalesce(x->>'q', '')) <= 10 and length(coalesce(x->>'spec', '')) <= 30, false))
    into bad from jsonb_array_elements(p_items) x;
  if bad then raise exception 'bad log' using errcode = 'CN211'; end if;
  select sum((x->>'got')::int), sum((x->>'out_of')::int) into g, o from jsonb_array_elements(p_items) x;
  if o > 120 then raise exception 'bad log' using errcode = 'CN211'; end if;
  if (select count(*) from paper_attempts where user_id = uid) >= 500 then raise exception 'too many' using errcode = 'CN211'; end if;
  insert into paper_attempts (user_id, course, paper_id, done_on, items, got, out_of) values (uid, p_course, p_paper, p_done, p_items, g, o) returning id into r;
  return r;
end $$;

create or replace function public.my_papers(p_course text)
returns table (id uuid, paper_id text, done_on date, items jsonb, got int, out_of int, cons_got int, cons_of int)
language sql stable security definer set search_path = public as $$
  select a.id, a.paper_id, a.done_on, a.items, a.got, a.out_of, a.cons_got, a.cons_of from paper_attempts a
  where a.user_id = require_user() and a.course = p_course order by a.done_on desc, a.created_at desc
$$;

create or replace function public.delete_paper(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from paper_attempts where id = p_id and user_id = require_user();
end $$;

create or replace function public.set_consolidation(p_id uuid, p_got int, p_of int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_of < 1 or p_of > 100 or p_got < 0 or p_got > p_of then raise exception 'bad score' using errcode = 'CN211'; end if;
  update paper_attempts set cons_got = p_got, cons_of = p_of where id = p_id and user_id = require_user();
end $$;

create or replace function public.set_reserved(p_class uuid, p_paper text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_own_class(p_class);
  if p_on then insert into reserved_papers (class_id, paper_id) values (p_class, p_paper) on conflict do nothing;
  else delete from reserved_papers where class_id = p_class and paper_id = p_paper; end if;
end $$;

create or replace function public.class_reserved(p_class uuid) returns setof text
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_own_class(p_class);
  return query select r.paper_id from reserved_papers r where r.class_id = p_class;
end $$;

-- Which papers to leave off the student's list. Only ids, and only for classes they're in.
create or replace function public.my_reserved_papers(p_course text) returns table (paper_id text)
language sql stable security definer set search_path = public as $$
  select distinct r.paper_id from reserved_papers r join classes c on c.id = r.class_id and c.course = p_course
  join class_members m on m.class_id = c.id and m.user_id = require_user() and m.left_at is null
$$;

do $$
declare f text;
begin
  foreach f in array array['log_paper(text, text, date, jsonb)', 'my_papers(text)', 'delete_paper(uuid)', 'set_consolidation(uuid, int, int)',
    'set_reserved(uuid, text, boolean)', 'class_reserved(uuid)', 'my_reserved_papers(text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
