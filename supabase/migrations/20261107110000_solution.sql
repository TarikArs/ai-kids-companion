-- « Solution » (parent setting): a Solution button on the Board; Silia writes the right answers of the active exercise
-- in chalk and explains the first mistake. Off by default. The server checks it before giving any answer.
alter table public.households add column if not exists solution_enabled boolean not null default false;

-- The new help action can wait for an exercise choice like the others.
alter table public.homework_sessions drop constraint if exists homework_sessions_pending_action_check;
alter table public.homework_sessions add constraint homework_sessions_pending_action_check
  check (pending_action in ('explain', 'solve', 'correct', 'similar', 'solution'));
