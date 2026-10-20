// Edge Function "notify": manda la notificación push al peluquero
// cuando un cliente acaba de coger cita.
// Despliegue: Supabase > Edge Functions > Deploy a new function > nombre "notify"
//             pega este código y DESACTIVA "Verify JWT".
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const fmt = (iso: string) =>
  new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { slot_id } = await req.json();
    if (!slot_id) return json({ error: "slot_id requerido" }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Solo avisa de citas reservadas en los últimos 5 min y una única vez
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: slot } = await sb.from("slots")
      .update({ notified: true })
      .eq("id", slot_id).eq("status", "booked").eq("notified", false).gte("booked_at", since)
      .select("client_name,starts_at").maybeSingle();
    if (!slot) return json({ sent: 0 });

    const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY");
    if (!pub || !priv) return json({ sent: 0, note: "VAPID no configurado" });
    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@cmhbarbers.com", pub, priv);

    const { data: subs } = await sb.from("push_subscriptions").select("*");
    const payload = JSON.stringify({
      title: "Nueva cita · CMH Barbers",
      body: `${slot.client_name} · ${fmt(slot.starts_at)}`,
      url: "./admin.html#citas",
    });
    let sent = 0;
    await Promise.allSettled((subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      }
    }));
    return json({ sent });
  } catch (e) {
    console.error(e);
    return json({ error: "Error inesperado" }, 500);
  }
});
