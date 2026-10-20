// =====================================================================
//  CONFIGURACIÓN — rellena estos 3 valores (ver SETUP.md)
//  Supabase > Project Settings > API
//  La "anon key" es pública por diseño: la seguridad real la ponen las
//  políticas RLS de la base de datos. NUNCA pongas aquí la service_role key.
// =====================================================================
window.CMH = {
  SUPABASE_URL: "https://ngtaxegnzekyhdexcifb.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_nd8gzrg5YelLhCXlt4B8tg_L6_0rdx9",
  VAPID_PUBLIC_KEY: "TU_CLAVE_PUBLICA_VAPID",   // solo para las notificaciones push

  // Usuario "admin" -> correo interno en Supabase Auth (no lo cambies)
  ADMIN_EMAIL: "admin@cmhbarbers.com",

  // Horario que aparece en el calendario del panel admin
  OPEN_HOUR: 9,      // primera hora
  CLOSE_HOUR: 22,    // el último hueco empieza antes de esta hora
  STEP_MIN: 30,      // duración de cada hueco (minutos): 15, 20, 30, 45, 60...

  // Hasta cuántos días vista pueden reservar los clientes
  DAYS_AHEAD: 30,
};
