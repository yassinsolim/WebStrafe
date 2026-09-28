-- webstrafe: timed surf runs (per map and per stage), ghosts, and kill boards.
--
-- run once in the supabase dashboard sql editor (or `supabase db push`) on the
-- project from public/config/webstrafe.config.json, after supabase/schema.sql.
-- safe to re-run: everything is create-if-missing or create-or-replace.
--
-- the browser only has the publishable (anon) key, so every write goes through
-- the security definer functions below. the tables allow public reads and no
-- direct writes. what the functions check:
--   - a run needs a token from start_run(), issued when the player leaves the
--     start zone. the claimed time can't be longer than the real time since the
--     token was issued (+ slack), which catches a sped up simulation, and each
--     token submits once.
--   - the time must be above the map's minimum (from zone geometry at a speed
--     no one reaches, and from the par time), splits must cover every stage in
--     order and each stage must be above its own minimum.
--   - per ip and per name rate limits on tokens, submits and kill reports.
--   - kill totals only go up, at most 20 kills per minute of session.
-- this raises the bar for casual cheating, it doesn't stop a determined client:
-- the simulation still runs in the browser.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- map rules

create table if not exists public.webstrafe_map_rules (
  map_id text primary key,
  modes text[] not null default '{surf}',
  -- checkpoint stage numbers from meta.json, in order (a one stage map has none)
  stages integer[] not null default '{}',
  min_time_ms integer not null check (min_time_ms > 0),
  -- minimum duration of stage 1..n (index 1 is stage 1), empty means unchecked
  min_stage_ms integer[] not null default '{}',
  ranked boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.webstrafe_map_rules enable row level security;
drop policy if exists "webstrafe_map_rules_read" on public.webstrafe_map_rules;
create policy "webstrafe_map_rules_read" on public.webstrafe_map_rules for select using (true);

-- ---------------------------------------------------------------- rate limits

-- private: no policies, so the anon key can't read or write it
create table if not exists public.webstrafe_rate_events (
  kind text not null,
  bucket text not null,
  at timestamptz not null default clock_timestamp()
);
create index if not exists webstrafe_rate_events_idx on public.webstrafe_rate_events (kind, bucket, at);
alter table public.webstrafe_rate_events enable row level security;

create or replace function public.webstrafe_client_bucket()
returns text
language sql
stable
as $$
  select md5('webstrafe:' || coalesce(
    nullif(trim(split_part(
      coalesce(current_setting('request.headers', true), '{}')::json ->> 'x-forwarded-for', ',', 1
    )), ''),
    'unknown'
  ));
$$;

-- records one event and says whether the bucket is still under max per window
create or replace function public.webstrafe_rate_ok(p_kind text, p_bucket text, p_max integer, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if random() < 0.02 then
    delete from webstrafe_rate_events where at < clock_timestamp() - interval '1 day';
  end if;
  select count(*) into n from webstrafe_rate_events
    where kind = p_kind and bucket = p_bucket and at > clock_timestamp() - p_window;
  if n >= p_max then
    return false;
  end if;
  insert into webstrafe_rate_events (kind, bucket) values (p_kind, p_bucket);
  return true;
end;
$$;

create or replace function public.webstrafe_valid_name(p_name text)
returns boolean
language sql
immutable
as $$
  select p_name is not null and p_name ~ '^[A-Za-z0-9 _.\-]{2,24}$' and p_name = trim(p_name);
$$;

-- ---------------------------------------------------------------- runs

create table if not exists public.webstrafe_run_tokens (
  id uuid primary key default gen_random_uuid(),
  map_id text not null references public.webstrafe_map_rules (map_id) on delete cascade,
  issued_at timestamptz not null default clock_timestamp(),
  used_at timestamptz
);
create index if not exists webstrafe_run_tokens_issued_idx on public.webstrafe_run_tokens (issued_at);
alter table public.webstrafe_run_tokens enable row level security;

create table if not exists public.webstrafe_runs (
  id uuid primary key default gen_random_uuid(),
  map_id text not null references public.webstrafe_map_rules (map_id) on delete cascade,
  name text not null check (public.webstrafe_valid_name(name)),
  model text not null,
  time_ms integer not null check (time_ms > 0),
  ticks integer not null check (ticks > 0),
  -- cumulative ticks at each checkpoint, same order as the map's stages
  splits integer[] not null default '{}',
  -- stage 1..n durations in ms
  stage_ms integer[] not null default '{}',
  pvp boolean not null default false,
  -- encoded replay, only kept on a player's best run per map
  ghost text check (ghost is null or char_length(ghost) <= 262144),
  created_at timestamptz not null default now()
);
create index if not exists webstrafe_runs_map_time_idx on public.webstrafe_runs (map_id, time_ms);
create index if not exists webstrafe_runs_map_name_idx on public.webstrafe_runs (map_id, lower(name), time_ms);
alter table public.webstrafe_runs enable row level security;
drop policy if exists "webstrafe_runs_read" on public.webstrafe_runs;
create policy "webstrafe_runs_read" on public.webstrafe_runs for select using (true);

-- best run per player per map
create or replace view public.webstrafe_run_bests with (security_invoker = true) as
  select distinct on (map_id, lower(name))
    id, map_id, name, model, time_ms, ticks, splits, stage_ms, pvp, created_at,
    ghost is not null as has_ghost
  from public.webstrafe_runs
  order by map_id, lower(name), time_ms, created_at;

-- best time per player per stage, taken from full runs
create or replace view public.webstrafe_stage_bests with (security_invoker = true) as
  select distinct on (r.map_id, s.stage, lower(r.name))
    r.id as run_id, r.map_id, s.stage::integer as stage, r.name, s.ms as time_ms, r.created_at
  from public.webstrafe_runs r
  cross join lateral unnest(r.stage_ms) with ordinality as s (ms, stage)
  order by r.map_id, s.stage, lower(r.name), s.ms, r.created_at;

create or replace function public.webstrafe_start_run(p_map_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  token uuid;
begin
  if not exists (select 1 from webstrafe_map_rules where map_id = p_map_id and ranked) then
    raise exception 'map not ranked' using errcode = '22023';
  end if;
  -- surfers restart a lot: one attempt every 2.5 s sustained is still fine
  if not webstrafe_rate_ok('start_run', webstrafe_client_bucket(), 240, interval '10 minutes') then
    raise exception 'rate limited' using errcode = '53400';
  end if;
  if random() < 0.02 then
    delete from webstrafe_run_tokens where issued_at < clock_timestamp() - interval '3 hours';
  end if;
  insert into webstrafe_run_tokens (map_id) values (p_map_id) returning id into token;
  return token;
end;
$$;

create or replace function public.webstrafe_submit_run(
  p_token uuid,
  p_name text,
  p_model text,
  p_ticks integer,
  p_splits integer[],
  p_pvp boolean,
  p_ghost text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tok webstrafe_run_tokens%rowtype;
  rules webstrafe_map_rules%rowtype;
  v_time_ms integer;
  v_elapsed_ms double precision;
  v_splits integer[] := coalesce(p_splits, '{}');
  v_stage_ms integer[] := '{}';
  v_prev integer := 0;
  v_prev_best integer;
  v_ghost text := null;
  v_id uuid;
  v_rank integer;
  i integer;
begin
  if not webstrafe_valid_name(p_name) then
    return jsonb_build_object('ok', false, 'reason', 'bad name');
  end if;
  if p_model not in ('terrorist', 'counterterrorist') then
    return jsonb_build_object('ok', false, 'reason', 'bad model');
  end if;
  if not webstrafe_rate_ok('submit_ip', webstrafe_client_bucket(), 12, interval '10 minutes')
     or not webstrafe_rate_ok('submit_name', lower(p_name), 12, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate limited');
  end if;

  select * into tok from webstrafe_run_tokens where id = p_token for update;
  if not found or tok.used_at is not null or tok.issued_at < clock_timestamp() - interval '2 hours' then
    return jsonb_build_object('ok', false, 'reason', 'bad or used run token');
  end if;
  update webstrafe_run_tokens set used_at = clock_timestamp() where id = tok.id;

  select * into rules from webstrafe_map_rules where map_id = tok.map_id;
  if not found or not rules.ranked then
    return jsonb_build_object('ok', false, 'reason', 'map not ranked');
  end if;

  if p_ticks is null or p_ticks <= 0 or p_ticks > 128 * 3600 then
    return jsonb_build_object('ok', false, 'reason', 'bad time');
  end if;
  v_time_ms := round(p_ticks * 1000.0 / 128);
  if v_time_ms < rules.min_time_ms then
    return jsonb_build_object('ok', false, 'reason', 'faster than the map allows');
  end if;
  -- the timer counts 128 hz ticks, so a run can't take longer in game time than
  -- it did in real time. 2.5 s covers the start_run round trip.
  v_elapsed_ms := extract(epoch from (clock_timestamp() - tok.issued_at)) * 1000;
  if v_time_ms > v_elapsed_ms + 2500 then
    return jsonb_build_object('ok', false, 'reason', 'timer ran faster than real time');
  end if;

  if coalesce(array_length(v_splits, 1), 0) <> coalesce(array_length(rules.stages, 1), 0) then
    return jsonb_build_object('ok', false, 'reason', 'missing stage splits');
  end if;
  for i in 1 .. coalesce(array_length(v_splits, 1), 0) loop
    if v_splits[i] is null or v_splits[i] <= v_prev or v_splits[i] >= p_ticks then
      return jsonb_build_object('ok', false, 'reason', 'splits out of order');
    end if;
    v_stage_ms := v_stage_ms || round((v_splits[i] - v_prev) * 1000.0 / 128)::integer;
    v_prev := v_splits[i];
  end loop;
  v_stage_ms := v_stage_ms || round((p_ticks - v_prev) * 1000.0 / 128)::integer;
  for i in 1 .. coalesce(array_length(rules.min_stage_ms, 1), 0) loop
    if i <= array_length(v_stage_ms, 1) and v_stage_ms[i] < rules.min_stage_ms[i] then
      return jsonb_build_object('ok', false, 'reason', format('stage %s faster than the map allows', i));
    end if;
  end loop;

  select min(r.time_ms) into v_prev_best from webstrafe_runs r
    where r.map_id = tok.map_id and lower(r.name) = lower(p_name);
  if p_ghost is not null
     and char_length(p_ghost) <= 262144
     and p_ghost ~ '^[A-Za-z0-9+/]+={0,2}$'
     and (v_prev_best is null or v_time_ms < v_prev_best) then
    v_ghost := p_ghost;
    update webstrafe_runs r set ghost = null
      where r.map_id = tok.map_id and lower(r.name) = lower(p_name) and r.ghost is not null;
  end if;

  insert into webstrafe_runs (map_id, name, model, time_ms, ticks, splits, stage_ms, pvp, ghost)
    values (tok.map_id, p_name, p_model, v_time_ms, p_ticks, v_splits, v_stage_ms, coalesce(p_pvp, false), v_ghost)
    returning id into v_id;

  select count(*) + 1 into v_rank from webstrafe_run_bests b
    where b.map_id = tok.map_id and b.time_ms < v_time_ms and lower(b.name) <> lower(p_name);

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'time_ms', v_time_ms,
    'rank', v_rank,
    'personal_best', v_prev_best is null or v_time_ms < v_prev_best
  );
end;
$$;

-- ---------------------------------------------------------------- kills

create table if not exists public.webstrafe_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (public.webstrafe_valid_name(name)),
  map_id text not null check (char_length(map_id) between 1 and 64),
  started_at timestamptz not null default now(),
  reported_at timestamptz,
  kills integer not null default 0 check (kills >= 0),
  deaths integer not null default 0 check (deaths >= 0)
);
create index if not exists webstrafe_sessions_started_idx on public.webstrafe_sessions (started_at);
alter table public.webstrafe_sessions enable row level security;
drop policy if exists "webstrafe_sessions_read" on public.webstrafe_sessions;
create policy "webstrafe_sessions_read" on public.webstrafe_sessions for select using (true);

create or replace view public.webstrafe_kills_daily with (security_invoker = true) as
  select min(name) as name, sum(kills)::integer as kills, sum(deaths)::integer as deaths
  from public.webstrafe_sessions
  where started_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
    and kills > 0
  group by lower(name);

create or replace view public.webstrafe_kills_alltime with (security_invoker = true) as
  select min(name) as name, sum(kills)::integer as kills, sum(deaths)::integer as deaths
  from public.webstrafe_sessions
  where kills > 0
  group by lower(name);

create or replace function public.webstrafe_start_session(p_name text, p_map_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
begin
  if not webstrafe_valid_name(p_name) then
    raise exception 'bad name' using errcode = '22023';
  end if;
  if not webstrafe_rate_ok('start_session', webstrafe_client_bucket(), 20, interval '10 minutes') then
    raise exception 'rate limited' using errcode = '53400';
  end if;
  insert into webstrafe_sessions (name, map_id) values (p_name, p_map_id) returning id into sid;
  return sid;
end;
$$;

-- totals for the whole session, sent every so often while playing
create or replace function public.webstrafe_report_session(p_session uuid, p_kills integer, p_deaths integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s webstrafe_sessions%rowtype;
  minutes double precision;
begin
  select * into s from webstrafe_sessions where id = p_session for update;
  if not found or s.started_at < now() - interval '12 hours' then
    return jsonb_build_object('ok', false, 'reason', 'bad session');
  end if;
  if s.reported_at is not null and s.reported_at > clock_timestamp() - interval '8 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'too soon');
  end if;
  if p_kills is null or p_deaths is null or p_kills < s.kills or p_deaths < s.deaths then
    return jsonb_build_object('ok', false, 'reason', 'totals only go up');
  end if;
  minutes := extract(epoch from (clock_timestamp() - s.started_at)) / 60.0;
  if p_kills > ceil(minutes) * 20 + 5 or p_deaths > ceil(minutes) * 20 + 5 then
    return jsonb_build_object('ok', false, 'reason', 'more kills than possible');
  end if;
  update webstrafe_sessions set kills = p_kills, deaths = p_deaths, reported_at = clock_timestamp()
    where id = s.id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- grants

revoke all on public.webstrafe_rate_events, public.webstrafe_run_tokens from anon, authenticated;
revoke insert, update, delete on public.webstrafe_map_rules, public.webstrafe_runs, public.webstrafe_sessions
  from anon, authenticated;
grant select on public.webstrafe_map_rules, public.webstrafe_runs, public.webstrafe_sessions to anon, authenticated;
grant select on public.webstrafe_run_bests, public.webstrafe_stage_bests,
  public.webstrafe_kills_daily, public.webstrafe_kills_alltime to anon, authenticated;

revoke all on function public.webstrafe_rate_ok(text, text, integer, interval) from public, anon, authenticated;
revoke all on function public.webstrafe_client_bucket() from public, anon, authenticated;
grant execute on function public.webstrafe_start_run(text) to anon, authenticated;
grant execute on function public.webstrafe_submit_run(uuid, text, text, integer, integer[], boolean, text) to anon, authenticated;
grant execute on function public.webstrafe_start_session(text, text) to anon, authenticated;
grant execute on function public.webstrafe_report_session(uuid, integer, integer) to anon, authenticated;

-- supabase's default grants give anon everything on new tables and views; the
-- client only ever reads them, so everything but select goes
revoke truncate, references, trigger on public.webstrafe_map_rules, public.webstrafe_runs, public.webstrafe_sessions
  from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.webstrafe_run_bests, public.webstrafe_stage_bests,
  public.webstrafe_kills_daily, public.webstrafe_kills_alltime from anon, authenticated;
alter function public.webstrafe_valid_name(text) set search_path = public;
alter function public.webstrafe_client_bucket() set search_path = public;
