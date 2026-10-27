-- Private Realtime channels named session:<homework_session_id>.
-- Only the household's parents and paired devices may join, send and receive.

create or replace function public.can_access_session_topic(topic text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  sid uuid;
begin
  if topic is null or topic not like 'session:%' then
    return false;
  end if;
  begin
    sid := substring(topic from 9)::uuid;
  exception when others then
    return false;
  end;
  return exists (
    select 1 from public.homework_sessions s
    where s.id = sid and public.is_household_member(s.household_id)
  );
end;
$$;

create policy "session members receive broadcast and presence" on realtime.messages
  for select to authenticated
  using (public.can_access_session_topic((select realtime.topic())));

create policy "session members send broadcast and presence" on realtime.messages
  for insert to authenticated
  with check (public.can_access_session_topic((select realtime.topic())));

-- Postgres Changes for the Parent app's slow-moving lists.
alter publication supabase_realtime add table public.homework_sessions, public.tutor_messages;
