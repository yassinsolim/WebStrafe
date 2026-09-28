-- checks for the surf runs and kills migration, run by tools/surf/test-migrations.sh
-- against a throwaway local postgres. every block raises on failure.

\set ON_ERROR_STOP on

insert into public.webstrafe_map_rules (map_id, stages, min_time_ms, min_stage_ms)
values ('test_map', '{2,3}', 5000, '{1000,1000,1000}')
on conflict (map_id) do update set stages = excluded.stages, min_time_ms = excluded.min_time_ms,
  min_stage_ms = excluded.min_stage_ms;

-- helper for the tests: a token issued p_ago before now (only the superuser can backdate)
create or replace function pg_temp.token_ago(p_ago interval) returns uuid language plpgsql as $$
declare t uuid;
begin
  set local role anon;
  t := public.webstrafe_start_run('test_map');
  reset role;
  update public.webstrafe_run_tokens set issued_at = clock_timestamp() - p_ago where id = t;
  return t;
end $$;

create or replace function pg_temp.submit(p_token uuid, p_name text, p_ticks int, p_splits int[], p_ghost text default null)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role anon;
  r := public.webstrafe_submit_run(p_token, p_name, 'terrorist', p_ticks, p_splits, false, p_ghost);
  reset role;
  return r;
end $$;

create or replace function pg_temp.expect(p_result jsonb, p_ok boolean, p_reason text default null) returns void
language plpgsql as $$
begin
  if (p_result ->> 'ok')::boolean is distinct from p_ok
     or (p_reason is not null and p_result ->> 'reason' is distinct from p_reason) then
    raise exception 'expected ok=% reason=%, got %', p_ok, p_reason, p_result;
  end if;
end $$;

select set_config('request.headers', '{"x-forwarded-for": "203.0.113.7, 10.0.0.1"}', false);

-- a clean 10 s run with both splits is ranked 1st
select pg_temp.expect(pg_temp.submit(pg_temp.token_ago('11 seconds'), 'Surfer One', 1280, '{400,900}', 'QUJD'), true);

-- a token only submits once
do $$
declare t uuid := pg_temp.token_ago('20 seconds');
begin
  perform pg_temp.expect(pg_temp.submit(t, 'Surfer One', 1300, '{400,900}'), true);
  perform pg_temp.expect(pg_temp.submit(t, 'Surfer One', 1300, '{400,900}'), false, 'bad or used run token');
end $$;

-- claimed 10 s but the token is 3 s old: the sim ran faster than real time
select pg_temp.expect(pg_temp.submit(pg_temp.token_ago('3 seconds'), 'Speedy', 1280, '{400,900}'), false,
  'timer ran faster than real time');

-- under the map minimum
select pg_temp.expect(pg_temp.submit(pg_temp.token_ago('1 minute'), 'Speedy', 500, '{100,300}'), false,
  'faster than the map allows');

-- splits missing, out of order, or a stage under its own minimum
select pg_temp.expect(pg_temp.submit(pg_temp.token_ago('1 minute'), 'Speedy', 1280, '{400}'), false, 'missing stage splits');
select pg_temp.expect(pg_temp.submit(pg_temp.token_ago('1 minute'), 'Speedy', 1280, '{900,400}'), false, 'splits out of order');
select pg_temp.expect(pg_temp.submit(pg_temp.token_ago('1 minute'), 'Speedy', 1280, '{400,450}'), false,
  'stage 2 faster than the map allows');

-- bad names never reach the table
select pg_temp.expect(pg_temp.submit(pg_temp.token_ago('1 minute'), 'x', 1280, '{400,900}'), false, 'bad name');
select pg_temp.expect(pg_temp.submit(pg_temp.token_ago('1 minute'), 'drop table;', 1280, '{400,900}'), false, 'bad name');

-- stage times are stored, the ghost only stays on the player's best run
do $$
declare
  r record;
  n int;
begin
  select * into r from public.webstrafe_run_bests where map_id = 'test_map' and name = 'Surfer One';
  if r.time_ms <> 10000 or r.stage_ms <> '{3125,3906,2969}' or not r.has_ghost then
    raise exception 'bad best row %', r;
  end if;
  perform pg_temp.expect(pg_temp.submit(pg_temp.token_ago('20 seconds'), 'Surfer One', 1200, '{380,880}', 'REVG'), true);
  select count(*) into n from public.webstrafe_runs where map_id = 'test_map' and name = 'Surfer One' and ghost is not null;
  if n <> 1 then raise exception 'expected one ghost, got %', n; end if;
  select count(*) into n from public.webstrafe_stage_bests where map_id = 'test_map' and name = 'Surfer One';
  if n <> 3 then raise exception 'expected 3 stage bests, got %', n; end if;
end $$;

-- anon can read the boards but can't write tables directly or see the private ones
do $$
declare ok boolean;
begin
  set local role anon;
  perform count(*) from public.webstrafe_run_bests;
  perform count(*) from public.webstrafe_kills_alltime;
  begin
    insert into public.webstrafe_runs (map_id, name, model, time_ms, ticks) values ('test_map', 'Cheater', 'terrorist', 1, 1);
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception 'anon inserted into webstrafe_runs'; end if;
  begin
    perform count(*) from public.webstrafe_run_tokens;
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception 'anon read webstrafe_run_tokens'; end if;
  begin
    perform public.webstrafe_rate_ok('x', 'y', 1, interval '1 minute');
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception 'anon called webstrafe_rate_ok'; end if;
  reset role;
end $$;

-- submits are capped per ip: 12 per 10 minutes (3 accepted and 6 rejected above count too)
do $$
declare
  i int;
  r jsonb;
  limited boolean := false;
begin
  for i in 1 .. 12 loop
    r := pg_temp.submit(pg_temp.token_ago('1 minute'), 'Grinder', 1280 + i, '{400,900}');
    if r ->> 'reason' = 'rate limited' then limited := true; end if;
  end loop;
  if not limited then raise exception 'submit rate limit never kicked in'; end if;
end $$;

-- kill sessions: totals only go up, reports are spaced out, and kills are capped per minute
do $$
declare
  sid uuid;
  r jsonb;
begin
  set local role anon;
  sid := public.webstrafe_start_session('Fragger', 'surf_vanta');
  reset role;
  update public.webstrafe_sessions set started_at = now() - interval '90 seconds' where id = sid;
  set local role anon;
  perform pg_temp.expect(public.webstrafe_report_session(sid, 4, 2), true);
  perform pg_temp.expect(public.webstrafe_report_session(sid, 5, 2), false, 'too soon');
  reset role;
  update public.webstrafe_sessions set reported_at = now() - interval '10 seconds' where id = sid;
  set local role anon;
  perform pg_temp.expect(public.webstrafe_report_session(sid, 3, 2), false, 'totals only go up');
  perform pg_temp.expect(public.webstrafe_report_session(sid, 500, 2), false, 'more kills than possible');
  perform pg_temp.expect(public.webstrafe_report_session(sid, 9, 3), true);
  select to_jsonb(k) into r from public.webstrafe_kills_daily k where name = 'Fragger';
  if (r ->> 'kills')::int <> 9 or (r ->> 'deaths')::int <> 3 then raise exception 'bad daily row %', r; end if;
  select to_jsonb(k) into r from public.webstrafe_kills_alltime k where name = 'Fragger';
  if (r ->> 'kills')::int <> 9 then raise exception 'bad all time row %', r; end if;
  reset role;
end $$;

select 'surf runs migration tests passed' as result;
