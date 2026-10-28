-- One Camera per household (several Boards are fine). pair-device refuses a second Camera; this index is the last guard.
-- Households that already have several active Cameras keep only the most recently linked one.
update public.devices d
set revoked_at = now()
where d.role = 'camera'
  and d.revoked_at is null
  and exists (
    select 1 from public.devices newer
    where newer.household_id = d.household_id
      and newer.role = 'camera'
      and newer.revoked_at is null
      and newer.created_at > d.created_at
  );

create unique index if not exists devices_one_camera_per_household
  on public.devices (household_id)
  where role = 'camera' and revoked_at is null;
