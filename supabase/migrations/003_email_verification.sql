-- Move booking verification from SMS to email while keeping the phone for the barber.
alter table public.bookings add column if not exists email text;
alter table public.booking_codes add column if not exists email text;
create index if not exists booking_codes_email on public.booking_codes(email, created_at);

drop function if exists public.confirm_booking(uuid, text, text);
create or replace function public.confirm_booking(p_slot_id uuid, p_customer_name text, p_phone text, p_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if p_customer_name is null or length(trim(p_customer_name)) < 3 then raise exception 'Nombre no válido'; end if;
  if p_phone is null or length(trim(p_phone)) < 7 then raise exception 'Teléfono no válido'; end if;
  if p_email is null or length(trim(p_email)) < 5 or position('@' in p_email) < 2 then raise exception 'Correo no válido'; end if;
  insert into public.bookings(slot_id, customer_name, phone, email)
  select id, trim(p_customer_name), trim(p_phone), lower(trim(p_email))
  from public.slots where id = p_slot_id and starts_at > now();
  if not found then raise exception 'Esta hora ya no está disponible'; end if;
  select id into new_id from public.bookings where slot_id = p_slot_id;
  return new_id;
end $$;
revoke all on function public.confirm_booking(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.confirm_booking(uuid, text, text, text) to service_role;
