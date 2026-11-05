-- Silia's voice, set by the parent. Off = text only on the Board and NO request to ElevenLabs (no credits used).
alter table public.households add column if not exists voice_enabled boolean not null default true;

-- The Board follows the setting live.
alter publication supabase_realtime add table public.households;
