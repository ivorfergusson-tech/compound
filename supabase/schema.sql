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
