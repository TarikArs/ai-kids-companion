-- Core schema for AI Homework Companion.
-- Every table carries household_id; access is granted to household parents and paired devices.
-- Devices (Board, Camera) sign in with Supabase anonymous auth and are linked to a household
-- by the pair-device Edge Function, so RLS uses auth.uid() for everyone.

-- ---------- tables ----------

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'parent' check (role in ('owner', 'parent')),
  display_name text,
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.children (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  birth_year int,
  languages text[] not null default '{fr}',
  avatar_path text,
  tutor_mode text not null default 'balanced' check (tutor_mode in ('gentle', 'balanced', 'active')),
  created_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  role text not null check (role in ('board', 'camera')),
  name text,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Written only by the pair-device Edge Function (service role). No client policies.
create table public.pairing_codes (
  code text primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  role text not null check (role in ('board', 'camera')),
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '10 minutes',
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null
);

create table public.homework_sessions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  subject text,
  language text not null default 'fr',
  status text not null default 'active' check (status in ('active', 'paused', 'finished')),
  capture_interval_s int not null default 45 check (capture_interval_s between 10 and 600),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  usage jsonb not null default '{}'
);

create table public.snapshots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  session_id uuid not null references public.homework_sessions (id) on delete cascade,
  storage_path text not null,
  taken_at timestamptz not null default now(),
  width int,
  height int,
  status text not null default 'uploaded' check (status in ('uploaded', 'analyzed', 'skipped', 'failed')),
  created_at timestamptz not null default now()
);

-- Exercise list parsed from the first clear photo of a page; later photos are compared to it.
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  session_id uuid not null references public.homework_sessions (id) on delete cascade,
  snapshot_id uuid references public.snapshots (id) on delete set null,
  task_type text not null default 'fill_in' check (task_type in ('fill_in', 'matching', 'number_line', 'copy', 'counting', 'other')),
  checkable boolean not null default true,
  items jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table public.observations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  session_id uuid not null references public.homework_sessions (id) on delete cascade,
  snapshot_id uuid not null references public.snapshots (id) on delete cascade,
  exercise_id uuid references public.exercises (id) on delete set null,
  item_id text not null,
  observed_answer text,
  is_correct boolean,
  confidence real check (confidence between 0 and 1),
  region jsonb,
  created_at timestamptz not null default now()
);

create table public.tutor_messages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  session_id uuid not null references public.homework_sessions (id) on delete cascade,
  kind text not null check (kind in ('hint', 'praise', 'question', 'encourage', 'parent_relay', 'system')),
  text text not null,
  language text not null default 'fr',
  audio_path text,
  annotations jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table public.child_utterances (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  session_id uuid not null references public.homework_sessions (id) on delete cascade,
  audio_path text,
  transcript text,
  language text,
  created_at timestamptz not null default now()
);

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  skill_key text not null,
  mastery real not null default 0 check (mastery between 0 and 1),
  evidence_count int not null default 0,
  last_practiced timestamptz,
  next_review date,
  unique (child_id, skill_key)
);

create table public.parent_messages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  session_id uuid not null references public.homework_sessions (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text text,
  voice_path text,
  created_at timestamptz not null default now(),
  check (text is not null or voice_path is not null)
);

-- ---------- indexes ----------

create index on public.household_members (user_id);
create index on public.children (household_id);
create index on public.devices (household_id);
create index on public.homework_sessions (household_id, started_at desc);
create index on public.snapshots (session_id, taken_at desc);
create index on public.exercises (session_id);
create index on public.observations (session_id, created_at);
create index on public.tutor_messages (session_id, created_at);
create index on public.child_utterances (session_id, created_at);
create index on public.skills (child_id);
create index on public.parent_messages (session_id, created_at);

-- ---------- access helpers ----------

-- Parent of the household (owner or parent).
create or replace function public.is_household_parent(hid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = (select auth.uid())
  );
$$;

-- Parent, or a paired device that has not been revoked.
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_household_parent(hid) or exists (
    select 1 from public.devices d
    where d.household_id = hid and d.user_id = (select auth.uid()) and d.revoked_at is null
  );
$$;

create or replace function public.is_household_owner(hid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.households h
    where h.id = hid and h.owner_id = (select auth.uid())
  );
$$;

-- The creator of a household becomes its owner member.
create or replace function public.add_household_owner()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.household_members (household_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger households_add_owner
after insert on public.households
for each row execute function public.add_household_owner();

-- ---------- row level security ----------

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.children enable row level security;
alter table public.devices enable row level security;
alter table public.pairing_codes enable row level security;
alter table public.homework_sessions enable row level security;
alter table public.snapshots enable row level security;
alter table public.exercises enable row level security;
alter table public.observations enable row level security;
alter table public.tutor_messages enable row level security;
alter table public.child_utterances enable row level security;
alter table public.skills enable row level security;
alter table public.parent_messages enable row level security;

-- households
create policy "members read household" on public.households
  for select to authenticated using (public.is_household_member(id));
create policy "anyone signed in creates own household" on public.households
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "owner updates household" on public.households
  for update to authenticated using (owner_id = (select auth.uid()));
create policy "owner deletes household" on public.households
  for delete to authenticated using (owner_id = (select auth.uid()));

-- household_members
create policy "members read members" on public.household_members
  for select to authenticated using (public.is_household_member(household_id));
create policy "owner adds parents" on public.household_members
  for insert to authenticated with check (public.is_household_owner(household_id) and role = 'parent');
create policy "owner removes parents" on public.household_members
  for delete to authenticated using (public.is_household_owner(household_id) and role = 'parent');

-- children
create policy "members read children" on public.children
  for select to authenticated using (public.is_household_member(household_id));
create policy "parents add children" on public.children
  for insert to authenticated with check (public.is_household_parent(household_id));
create policy "parents edit children" on public.children
  for update to authenticated using (public.is_household_parent(household_id));
create policy "parents delete children" on public.children
  for delete to authenticated using (public.is_household_parent(household_id));

-- devices (created by pair-device with the service role)
create policy "members read devices" on public.devices
  for select to authenticated using (public.is_household_member(household_id));
create policy "parents revoke devices" on public.devices
  for update to authenticated using (public.is_household_parent(household_id));
create policy "parents delete devices" on public.devices
  for delete to authenticated using (public.is_household_parent(household_id));

-- pairing_codes: no client policies; Edge Functions only.

-- homework_sessions
create policy "members read sessions" on public.homework_sessions
  for select to authenticated using (public.is_household_member(household_id));
create policy "members start sessions" on public.homework_sessions
  for insert to authenticated with check (public.is_household_member(household_id));
create policy "members update sessions" on public.homework_sessions
  for update to authenticated using (public.is_household_member(household_id));

-- snapshots: the Camera inserts; the Edge Function updates status
create policy "members read snapshots" on public.snapshots
  for select to authenticated using (public.is_household_member(household_id));
create policy "members add snapshots" on public.snapshots
  for insert to authenticated with check (public.is_household_member(household_id));

-- written by Edge Functions only, readable by the household
create policy "members read exercises" on public.exercises
  for select to authenticated using (public.is_household_member(household_id));
create policy "members read observations" on public.observations
  for select to authenticated using (public.is_household_member(household_id));
create policy "members read tutor messages" on public.tutor_messages
  for select to authenticated using (public.is_household_member(household_id));
create policy "members read skills" on public.skills
  for select to authenticated using (public.is_household_member(household_id));

-- child_utterances: the Camera inserts the clip row; the Edge Function fills the transcript
create policy "members read utterances" on public.child_utterances
  for select to authenticated using (public.is_household_member(household_id));
create policy "members add utterances" on public.child_utterances
  for insert to authenticated with check (public.is_household_member(household_id));

-- parent_messages
create policy "members read parent messages" on public.parent_messages
  for select to authenticated using (public.is_household_member(household_id));
create policy "parents send messages" on public.parent_messages
  for insert to authenticated with check (public.is_household_parent(household_id) and user_id = (select auth.uid()));
