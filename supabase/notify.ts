// Edge Function "notify": manda la notificación push al peluquero.
//  - {slot_id}  -> tras una reserva nueva (la llama la web del cliente)
//  - {test:true} -> prueba desde el panel admin (requiere sesión de admin)
// Despliegue: Supabase > Edge Functions > "notify" > pega este código y DESACTIVA "Verify JWT".
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
    const body = await req.json().catch(() => ({}));
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let title = "Nueva cita · CMH Barbers";
    let text = "";
    const isTest = body.test === true;

    if (isTest) {
      // Solo el admin puede lanzar la prueba
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: u, error: ue } = await sb.auth.getUser(token);
      const adminEmail = Deno.env.get("ADMIN_EMAIL") ?? "admin@cmhbarbers.com";
      if (ue || u?.user?.email !== adminEmail) return json({ error: "No autorizado (inicia sesión como admin)" }, 401);
      title = "Prueba · CMH Barbers";
      text = "Las notificaciones funcionan correctamente ✅";
    } else {
      if (!body.slot_id) return json({ error: "slot_id requerido" }, 400);
      const since = new Date(Date.now() - 5 * 60_000).toISOString();
      const { data: slot, error: se } = await sb.from("slots")
        .update({ notified: true })
        .eq("id", body.slot_id).eq("status", "booked").eq("notified", false).gte("booked_at", since)
        .select("client_name,starts_at,location").maybeSingle();
      if (se) { console.error("slot update", se); return json({ sent: 0, step: "slot", error: se.message }); }
      if (!slot) return json({ sent: 0, step: "slot", note: "cita no encontrada, ya avisada o antigua" });
      text = `${slot.client_name} · ${fmt(slot.starts_at)} · ${slot.location === "barcarrota" ? "Barcarrota" : "Badajoz"}`;
    }

    const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY");
    if (!pub || !priv)
      return json({ sent: 0, step: "vapid", error: "Faltan los secretos VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY en Supabase" });
    try {
      webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@cmhbarbers.com", pub.trim(), priv.trim());
    } catch (e) {
      return json({ sent: 0, step: "vapid", error: "Claves VAPID o VAPID_SUBJECT no válidos: " + (e as Error).message });
    }

    const { data: subs, error: sbErr } = await sb.from("push_subscriptions").select("*");
    if (sbErr) return json({ sent: 0, step: "subs", error: sbErr.message });
    if (!subs?.length)
      return json({ sent: 0, step: "subs", subscriptions: 0, error: "No hay ningún dispositivo suscrito. Pulsa «Activar notificaciones» en el panel." });

    const payload = JSON.stringify({ title, body: text, url: "./admin.html#citas" });
    let sent = 0;
    const failures: { status?: number; message: string }[] = [];
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: "high" });
        sent++;
      } catch (err) {
        const e = err as { statusCode?: number; body?: string; message?: string };
        console.error("push error", e.statusCode, e.body ?? e.message);
        failures.push({ status: e.statusCode, message: (e.body || e.message || "error").toString().slice(0, 200) });
        if (e.statusCode === 404 || e.statusCode === 410) await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      }
    }));
    return json({ sent, subscriptions: subs.length, failures });
  } catch (e) {
    console.error(e);
    return json({ sent: 0, error: "Error inesperado: " + (e as Error).message }, 500);
  }
});
