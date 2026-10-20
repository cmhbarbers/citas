-- =====================================================================
--  CMH Barbers · base de datos (Supabase / PostgreSQL)
--  Pégalo ENTERO en Supabase > SQL Editor > New query > Run
--  (se puede ejecutar más de una vez sin problema)
-- =====================================================================

create extension if not exists pgcrypto;

-- 1. Tablas -----------------------------------------------------------

-- Cada fila = una hora habilitada por el peluquero.
create table if not exists public.slots (
  id            uuid primary key default gen_random_uuid(),
  starts_at     timestamptz not null unique,
  location      text not null default 'badajoz' check (location in ('badajoz', 'barcarrota')),
  status        text not null default 'free' check (status in ('free', 'booked')),
  client_name   text,
  client_phone  text,
  booked_at     timestamptz,
  notified      boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists slots_starts_at_idx on public.slots (starts_at);

-- Móviles/PC del peluquero con notificaciones push activadas.
create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

-- 2. Quién es admin (usuario "admin" = correo interno admin@cmhbarbers.com)
create or replace function public.is_admin()
returns boolean language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'admin@cmhbarbers.com'
$$;

-- 3. Seguridad (RLS): solo el admin toca las tablas directamente ---------
alter table public.slots              enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "admin gestiona slots" on public.slots;
create policy "admin gestiona slots" on public.slots
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin gestiona suscripciones" on public.push_subscriptions;
create policy "admin gestiona suscripciones" on public.push_subscriptions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 4. Lo que ven los clientes: solo horas libres, sin datos de nadie ------
create or replace view public.available_slots as
  select id, starts_at, location from public.slots
  where status = 'free' and starts_at > now();
grant select on public.available_slots to anon, authenticated;

-- 5. Reservar una hora (la llama la web del cliente) --------------------
create or replace function public.book_slot(p_slot uuid, p_name text, p_phone text)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_name  text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[\s\-().]', '', 'g');
  v_count int;
  v_start timestamptz;
begin
  if char_length(v_name) < 5 or char_length(v_name) > 80 or position(' ' in v_name) = 0 then
    raise exception 'BAD_NAME';
  end if;
  if v_phone !~ '^(\+|00)?[0-9]{9,15}$' then
    raise exception 'BAD_PHONE';
  end if;

  -- Antiabuso: máximo 2 citas futuras por teléfono
  select count(*) into v_count from public.slots s
   where s.client_phone = v_phone and s.status = 'booked' and s.starts_at > now();
  if v_count >= 2 then raise exception 'LIMIT_REACHED'; end if;

  update public.slots s
     set status = 'booked', client_name = v_name, client_phone = v_phone,
         booked_at = now(), notified = false
   where s.id = p_slot and s.status = 'free' and s.starts_at > now()
  returning s.starts_at into v_start;

  if v_start is null then raise exception 'SLOT_TAKEN'; end if;
  return v_start;
end $$;

revoke all on function public.book_slot(uuid, text, text) from public;
grant execute on function public.book_slot(uuid, text, text) to anon, authenticated;

-- 6. Tiempo real para el panel del peluquero ----------------------------
do $$ begin
  alter publication supabase_realtime add table public.slots;
exception when duplicate_object then null; end $$;
