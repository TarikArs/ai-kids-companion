-- « Un seul téléphone »: no TV or tablet. After each photo, the phone itself turns into the Board (landscape),
-- then « Retour à la caméra ». Household setting, like voice_enabled (households is already in the realtime publication).
alter table public.households add column if not exists solo_mode boolean not null default false;
