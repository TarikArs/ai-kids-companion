-- Exercise focus: the photo is the context, the child picks (by voice or by tap) the exercise to work on.

-- Page context extracted once per photo (printed text, exercises, instructions, the child's visible answers).
alter table public.snapshots add column if not exists exercises jsonb;

-- Active exercise of the session ({index, title, label, region, snapshot_id, action, at}) and the action
-- waiting for an exercise choice ("explain it" said while several exercises are on the page).
alter table public.homework_sessions add column if not exists focus jsonb;
alter table public.homework_sessions add column if not exists pending_action text
  check (pending_action in ('explain', 'solve', 'correct'));

-- Which exercise and which help each tutor message was about (explanation level, follow-ups).
alter table public.tutor_messages add column if not exists exercise_index smallint;
alter table public.tutor_messages add column if not exists action text;
