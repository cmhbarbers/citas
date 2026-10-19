-- Reservations no longer require an email address or verification code.
-- Keep the old booking_codes table intact in case it contains historical data.
drop function if exists public.confirm_booking(uuid, text, text);
drop function if exists public.confirm_booking(uuid, text, text, text);

create or replace function public.book_slot(p_slot_id uuid, p_customer_name text, p_phone text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if p_customer_name is null or length(trim(p_customer_name)) < 3 or length(trim(p_customer_name)) > 120 then
    raise exception 'Nombre no válido';
  end if;
  if p_phone is null or length(trim(p_phone)) < 7 or length(trim(p_phone)) > 24 then
    raise exception 'Teléfono no válido';
  end if;

  insert into public.bookings(slot_id, customer_name, phone)
  select id, trim(p_customer_name), trim(p_phone)
  from public.slots
  where id = p_slot_id and starts_at > now();

  if not found then
    raise exception 'Esta hora ya no está disponible';
  end if;

  select id into new_id from public.bookings where slot_id = p_slot_id;
  return new_id;
end;
$$;

revoke all on function public.book_slot(uuid, text, text) from public, anon, authenticated;
grant execute on function public.book_slot(uuid, text, text) to service_role;
