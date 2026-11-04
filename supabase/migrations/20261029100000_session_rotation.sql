-- Orientation is decided once per session (the Camera stays on its stand): set by the first readable photo,
-- corrected with the Board's rotate button. null = not decided yet.
alter table public.homework_sessions add column if not exists rotation smallint
  check (rotation in (0, 90, 180, 270));
