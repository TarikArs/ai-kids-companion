-- Board refresh = start over: the active exercise is cleared and answers judged before this moment are not reused.
alter table public.homework_sessions add column if not exists fresh_at timestamptz;
