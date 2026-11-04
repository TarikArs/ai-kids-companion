-- The evening's plan (read from the homework diary) and the end-of-session summary (recap for the child, report for the parent).
alter table public.homework_sessions add column if not exists plan jsonb;
alter table public.homework_sessions add column if not exists summary jsonb;
