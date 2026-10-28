-- School level per child (1-6 = primary year, 7 = collège), used by every AI prompt.
alter table public.children
  add column grade smallint not null default 1 check (grade between 1 and 7);

-- New familiar phrase kind: "Which exercise should I explain?"
alter table public.tutor_phrases drop constraint if exists tutor_phrases_kind_check;
alter table public.tutor_phrases
  add constraint tutor_phrases_kind_check
  check (kind in ('praise', 'encourage', 'hint', 'explain', 'filler', 'greeting', 'pause', 'resume', 'end', 'ask'));
