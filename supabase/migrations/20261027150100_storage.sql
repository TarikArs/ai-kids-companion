-- Private buckets. Object paths start with the household id: <household_id>/<session_id>/<file>.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('snapshots', 'snapshots', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('audio-in', 'audio-in', false, 10485760, array['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/wav', 'audio/webm']),
  ('tts-cache', 'tts-cache', false, 10485760, array['audio/mpeg']),
  ('avatars', 'avatars', false, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- First path segment as uuid, or null when it is not a uuid.
create or replace function public.path_household(object_name text)
returns uuid
language plpgsql immutable set search_path = ''
as $$
begin
  return (storage.foldername(object_name))[1]::uuid;
exception when others then
  return null;
end;
$$;

create policy "household reads its media" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('snapshots', 'audio-in', 'avatars')
    and public.is_household_member(public.path_household(name))
  );

create policy "household uploads photos and audio" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('snapshots', 'audio-in')
    and public.is_household_member(public.path_household(name))
  );

create policy "parents upload avatars" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and public.is_household_parent(public.path_household(name))
  );

-- Generated speech is keyed by a hash of the text, not by household: any signed-in device may read it.
-- Only Edge Functions (service role) write it.
create policy "signed in reads tts cache" on storage.objects
  for select to authenticated
  using (bucket_id = 'tts-cache');
