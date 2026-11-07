-- Language of the app's own texts (buttons, screens) for every device of the family. Not Silia's language.
-- 'system' = each device follows its own language.
alter table public.households add column if not exists app_lang text not null default 'system'
  check (app_lang in ('system', 'fr', 'en', 'ar'));
