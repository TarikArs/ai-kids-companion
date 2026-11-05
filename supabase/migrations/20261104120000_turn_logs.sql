-- Speed and cost per turn: one row per request (analyze-snapshot, child-talk, explain-exercise).
-- Written by the Edge Functions only (service role); no client access.
create table if not exists public.turn_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  fn text not null,
  session_id uuid references public.homework_sessions (id) on delete cascade,
  household_id uuid references public.households (id) on delete cascade,
  turn_id text,
  priority text,
  ms integer not null,
  timings jsonb,
  model text,
  effort text,
  usage jsonb,
  outcome text,
  extra jsonb
);
create index if not exists turn_logs_created on public.turn_logs (created_at desc);
alter table public.turn_logs enable row level security;
