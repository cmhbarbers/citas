import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  try {
    const { slotId, name, phone } = await req.json();
    const customerName = String(name || '').trim();
    const customerPhone = String(phone || '').trim();
    if (!slotId || customerName.length < 3 || customerName.length > 120 || !/^\+?[0-9 ()-]{7,18}$/.test(customerPhone)) {
      return json({ error: 'Revisa el nombre y el teléfono.' }, 400);
    }

    const env = (key: string) => {
      const value = Deno.env.get(key);
      if (!value) throw new Error(`Falta configurar ${key}`);
      return value;
    };
    const projectUrl = env('SUPABASE_URL');
    const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
    const db = createClient(projectUrl, serviceKey);
    const { data: bookingId, error } = await db.rpc('book_slot', {
      p_slot_id: slotId,
      p_customer_name: customerName,
      p_phone: customerPhone,
    });

    if (error) {
      console.error('Booking error', error);
      const conflict = error.code === '23505' || error.message.includes('no está disponible');
      return json({ error: conflict ? 'Esta hora acaba de ser reservada. Elige otra.' : 'No se pudo reservar la hora.' }, conflict ? 409 : 400);
    }

    // Push delivery is best-effort: the booking stays confirmed if push is unavailable.
    await fetch(`${projectUrl}/functions/v1/notify-admin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId }),
    }).catch((error) => console.error('Admin push notification failed', error));

    return json({ ok: true, bookingId });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'No se pudo reservar la cita.' }, 500);
  }
});
