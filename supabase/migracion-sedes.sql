-- =====================================================================
--  MIGRACIÓN: sedes (Badajoz / Barcarrota)
--  Si ya tenías la base de datos creada: pega esto en Supabase >
--  SQL Editor > New query > Run. (Se puede ejecutar varias veces.)
--  Las horas que ya existían quedan asignadas a Badajoz; el peluquero
--  puede cambiarlas desde el panel.
-- =====================================================================

alter table public.slots
  add column if not exists location text not null default 'badajoz';

alter table public.slots drop constraint if exists slots_location_check;
alter table public.slots
  add constraint slots_location_check check (location in ('badajoz', 'barcarrota'));

-- La vista que ven los clientes ahora incluye la sede
create or replace view public.available_slots as
  select id, starts_at, location from public.slots
  where status = 'free' and starts_at > now();

grant select on public.available_slots to anon, authenticated;
