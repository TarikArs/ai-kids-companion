-- Reading turns (push-to-talk): the page text is extracted once per photo and reused for every turn.
alter table public.snapshots add column page_text text;
alter table public.snapshots add column page_lang text;

-- New familiar phrase kind for good reading.
alter table public.tutor_phrases drop constraint if exists tutor_phrases_kind_check;
alter table public.tutor_phrases
  add constraint tutor_phrases_kind_check
  check (kind in ('praise', 'encourage', 'hint', 'explain', 'filler', 'greeting', 'pause', 'resume', 'end', 'ask', 'read_good'));
