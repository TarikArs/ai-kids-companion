-- Quality signals: small events that say where Silia struggles (a page photographed again, a misread answer, a verdict
-- the child disputes, an explanation asked twice, no answer in time…). Read by supabase/queries/quality.sql to compare
-- prompt versions. No photo and no audio here: short texts only (an item, a read answer), linked to the snapshot.
create table if not exists public.feedback_signals (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  session_id uuid references public.homework_sessions (id) on delete cascade,
  snapshot_id uuid references public.snapshots (id) on delete set null,
  kind text not null,
  exercise int,
  data jsonb not null default '{}'::jsonb,
  prompt_version text,
  model text,
  ms int,
  created_at timestamptz not null default now()
);
create index if not exists feedback_signals_session on public.feedback_signals (session_id, created_at desc);
create index if not exists feedback_signals_kind on public.feedback_signals (kind, created_at desc);

alter table public.feedback_signals enable row level security;
-- The server functions write with the service role. The Board may report one thing itself: Silia gave no answer in time.
create policy "members report a timeout" on public.feedback_signals
  for insert to authenticated with check (public.is_household_member(household_id) and kind = 'timeout');
-- Parents can read their family's signals (for a future « qualité » view); devices cannot.
create policy "parents read signals" on public.feedback_signals
  for select to authenticated using (public.is_household_parent(household_id));
