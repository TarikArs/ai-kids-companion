-- Clockwise rotation (0/90/180/270) needed to show the photo upright. The Board turns it for display;
-- regions stay in the photo's own coordinates.
alter table public.snapshots add column rotation smallint not null default 0 check (rotation in (0, 90, 180, 270));
