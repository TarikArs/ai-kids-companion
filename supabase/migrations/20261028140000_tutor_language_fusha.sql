-- Standard Arabic (Fusha, code 'fus') as a tutor language, next to Darija ('ar').
alter table public.children drop constraint if exists children_tutor_language_check;
alter table public.children
  add constraint children_tutor_language_check check (tutor_language in ('auto', 'fr', 'ar', 'fus', 'en'));

alter table public.tutor_phrases drop constraint if exists tutor_phrases_lang_check;
alter table public.tutor_phrases
  add constraint tutor_phrases_lang_check check (lang in ('fr', 'ar', 'fus', 'en'));
