-- « Tu es là ? » : Silia's familiar phrases when she has been waiting a while (recorded once, by warm-phrases).
alter table public.tutor_phrases drop constraint if exists tutor_phrases_kind_check;
alter table public.tutor_phrases
  add constraint tutor_phrases_kind_check
  check (kind in ('praise', 'encourage', 'hint', 'explain', 'filler', 'greeting', 'pause', 'resume', 'end', 'ask', 'read_good', 'nudge'));
