-- Reset (phase R1): remove tables and columns that no code uses any more.
-- Photos are now taken only when the child presses « Silia, regarde »; the diary plan, automatic capture and the
-- per-photo orientation are gone. Run once in the SQL Editor. Data in these tables and columns is deleted.

-- Tables never used by the app or the functions.
drop table if exists public.parent_messages;
drop table if exists public.skills;
alter table public.observations drop column if exists exercise_id;
drop table if exists public.exercises;

-- homework_sessions: automatic capture interval, diary plan, unused subject and usage.
alter table public.homework_sessions
  drop column if exists capture_interval_s,
  drop column if exists plan,
  drop column if exists subject,
  drop column if exists usage;

-- children: profile fields never shown or used.
alter table public.children
  drop column if exists birth_year,
  drop column if exists languages,
  drop column if exists avatar_path,
  drop column if exists tutor_mode;

alter table public.household_members drop column if exists display_name;

-- Orientation is kept per session (homework_sessions.rotation), not per photo.
alter table public.snapshots drop column if exists rotation;
