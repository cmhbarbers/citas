create extension if not exists pgcrypto;

create table if not exists public.slots (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null unique,
  created_at timestamptz not null default now(),
  constraint slot_on_full_hour check (extract(minute from starts_at) = 0)
);
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null unique references public.slots(id) on delete restrict,
  customer_name text not null check (length(customer_name) between 3 and 120),
  phone text not null check (length(phone) between 7 and 24),
  email text,
  created_at timestamptz not null default now()
);
create table if not exists public.booking_codes (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.slots(id) on delete cascade,
  customer_name text not null,
  phone text not null,
  email text,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists booking_codes_expiry on public.booking_codes(expires_at);
create index if not exists booking_codes_email on public.booking_codes(email,created_at);
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

create or replace function public.is_cmh_admin() returns boolean
language sql stable as $$ select coalesce(auth.jwt()->'app_metadata'->>'role' = 'admin', false) $$;
create or replace function public.is_slot_open(p_slot_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists(select 1 from public.bookings where slot_id = p_slot_id)
$$;

alter table public.slots enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_codes enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "Public sees future unbooked times" on public.slots for select to anon, authenticated
  using (starts_at > now() and public.is_slot_open(id));
create policy "Admin manages times" on public.slots for all to authenticated
  using (public.is_cmh_admin()) with check (public.is_cmh_admin());
create policy "Admin reads bookings" on public.bookings for select to authenticated using (public.is_cmh_admin());
create policy "Admin cancels bookings" on public.bookings for delete to authenticated using (public.is_cmh_admin());
create policy "Admin manages push devices" on public.push_subscriptions for all to authenticated
  using (public.is_cmh_admin()) with check (public.is_cmh_admin());
revoke all on public.booking_codes from anon, authenticated;
revoke all on public.bookings from anon;
grant select on public.slots to anon, authenticated;
grant insert, update, delete on public.slots to authenticated;
grant select, delete on public.bookings to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create or replace function public.confirm_booking(p_slot_id uuid, p_customer_name text, p_phone text, p_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if p_customer_name is null or length(trim(p_customer_name)) < 3 then raise exception 'Nombre no válido'; end if;
  if p_phone is null or length(trim(p_phone)) < 7 then raise exception 'Teléfono no válido'; end if;
  if p_email is null or length(trim(p_email)) < 5 or position('@' in p_email) < 2 then raise exception 'Correo no válido'; end if;
  insert into public.bookings(slot_id, customer_name, phone, email)
  select id, trim(p_customer_name), trim(p_phone), lower(trim(p_email)) from public.slots where id = p_slot_id and starts_at > now();
  if not found then raise exception 'Esta hora ya no está disponible'; end if;
  select id into new_id from public.bookings where slot_id = p_slot_id;
  return new_id;
end $$;
revoke all on function public.confirm_booking(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.confirm_booking(uuid,text,text,text) to service_role;

grant usage on schema public to anon, authenticated;
grant execute on function public.is_slot_open(uuid) to anon, authenticated;
