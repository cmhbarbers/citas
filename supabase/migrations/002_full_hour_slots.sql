-- Upgrade existing projects from the initial 10:00–20:00 half-hour grid.
alter table public.slots drop constraint if exists slot_on_half_hour;
alter table public.slots drop constraint if exists slot_on_full_hour;
alter table public.slots add constraint slot_on_full_hour check (extract(minute from starts_at) = 0);

-- Keep confirmed appointments if an administrator tries to remove their time slot.
alter table public.bookings drop constraint if exists bookings_slot_id_fkey;
alter table public.bookings add constraint bookings_slot_id_fkey
  foreign key (slot_id) references public.slots(id) on delete restrict;
