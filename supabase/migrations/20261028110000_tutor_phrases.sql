-- Familiar tutor phrases (Bravo, Hmm, Je regarde…) in every language, generated once with ElevenLabs.
-- The Board loads this list at start and plays the audio directly: no TTS call, no lookup per message.

create table public.tutor_phrases (
  lang text not null check (lang in ('fr', 'ar', 'en')),
  kind text not null check (kind in ('praise', 'encourage', 'hint', 'explain', 'filler', 'greeting', 'pause', 'resume', 'end')),
  text text not null,
  audio_path text not null,
  updated_at timestamptz not null default now(),
  primary key (lang, text)
);

alter table public.tutor_phrases enable row level security;

-- Shared by every household; written only by the warm-phrases Edge Function (service role).
create policy "signed in reads phrases" on public.tutor_phrases
  for select to authenticated using (true);
