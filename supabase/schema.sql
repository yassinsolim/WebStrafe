-- WebStrafe leaderboard schema for Supabase.
-- Run this once in the Supabase dashboard (SQL Editor) for the project whose
-- URL/publishable key are in public/config/webstrafe.config.json.
--
-- The client uses only the publishable key, so writes are constrained by the
-- row-level security policies below (public read, validated public insert,
-- no update/delete). No service key is ever shipped to the browser.

create table if not exists public.webstrafe_leaderboard (
  id uuid primary key default gen_random_uuid(),
  map_id text not null,
  name text not null,
  time_ms integer not null,
  model text not null,
  created_at timestamptz not null default now()
);

-- Fast "top runs for a map" query (order by time ascending).
create index if not exists webstrafe_leaderboard_map_time_idx
  on public.webstrafe_leaderboard (map_id, time_ms);

alter table public.webstrafe_leaderboard enable row level security;

-- Anyone may read the leaderboard.
drop policy if exists "webstrafe_leaderboard_read" on public.webstrafe_leaderboard;
create policy "webstrafe_leaderboard_read"
  on public.webstrafe_leaderboard
  for select
  using (true);

-- Anyone may submit a run, but the row must pass these sanity checks.
drop policy if exists "webstrafe_leaderboard_insert" on public.webstrafe_leaderboard;
create policy "webstrafe_leaderboard_insert"
  on public.webstrafe_leaderboard
  for insert
  with check (
    char_length(name) between 2 and 24
    and char_length(map_id) between 1 and 64
    and time_ms > 0
    and time_ms < 3600000
    and model in ('terrorist', 'counterterrorist')
  );

-- No update/delete policies => rows are immutable from the client.
