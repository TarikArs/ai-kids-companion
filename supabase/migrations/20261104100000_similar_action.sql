-- "Exercice similaire": a new help action that can wait for an exercise choice.
alter table public.homework_sessions drop constraint if exists homework_sessions_pending_action_check;
alter table public.homework_sessions add constraint homework_sessions_pending_action_check
  check (pending_action in ('explain', 'solve', 'correct', 'similar'));
