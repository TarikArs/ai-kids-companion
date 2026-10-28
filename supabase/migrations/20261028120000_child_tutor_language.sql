-- Tutor language per child: 'auto' follows the exercise's language, otherwise always this language.
alter table public.children
  add column tutor_language text not null default 'auto'
  check (tutor_language in ('auto', 'fr', 'ar', 'en'));
