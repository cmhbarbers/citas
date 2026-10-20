/* CMH Barbers · panel del peluquero */
(() => {
  const cfg = window.CMH;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const $ = (s, r = document) => r.querySelector(s);
  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timeKey = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const fmtLong = (d) => d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function toast(msg) {
    const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 3500);
  }

  // =====================================================================
  //  Sesión
  // =====================================================================
  async function boot() {
    const { data: { session } } = await sb.auth.getSession();
    if (session && session.user.email === cfg.ADMIN_EMAIL) showApp();
    else { if (session) await sb.auth.signOut(); showLogin(); }
  }

  function showLogin() {
    $("#appView").hidden = true; $("#loginView").hidden = false;
    $("#user").focus();
  }

  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const err = $("#loginErr"), btn = $("#loginBtn");
    err.textContent = "";
    const u = $("#user").value.trim().toLowerCase();
    const p = $("#pass").value;
    if (!u || !p) return (err.textContent = "Escribe usuario y contraseña.");
    const email = u === "admin" ? cfg.ADMIN_EMAIL : u;
    btn.disabled = true; btn.textContent = "Entrando…";
    const { data, error } = await sb.auth.signInWithPassword({ email, password: p });
    btn.disabled = false; btn.textContent = "Entrar";
    if (error || data.user?.email !== cfg.ADMIN_EMAIL) {
      if (!error) await sb.auth.signOut();
      err.textContent = "Usuario o contraseña incorrectos.";
      return;
    }
    $("#pass").value = "";
    showApp();
  };

  $("#logout").onclick = async () => {
    if (channel) sb.removeChannel(channel);
    await sb.auth.signOut();
    location.reload();
  };

  // =====================================================================
  //  Estado
  // =====================================================================
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  let viewYear = today0.getFullYear(), viewMonth = today0.getMonth();
  let selected = new Date(today0);
  let monthSlots = new Map();      // dayKey -> Map(timeKey -> slot)
  let upcoming = [];               // citas futuras
  let knownBooked = null;
  let channel = null;

  const TIMES = (() => {
    const out = [];
    for (let m = cfg.OPEN_HOUR * 60; m < cfg.CLOSE_HOUR * 60; m += cfg.STEP_MIN) out.push([Math.floor(m / 60), m % 60]);
    return out;
  })();

  function showApp() {
    $("#loginView").hidden = true; $("#appView").hidden = false;
    loadMonth(); loadAppointments();
    setupPush();
    subscribeRealtime();
    if (location.hash === "#citas") switchTab("citas");
  }

  // ---------- pestañas ----------
  document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => switchTab(t.dataset.tab)));
  function switchTab(name) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === name));
    $("#tab-horarios").hidden = name !== "horarios";
    $("#tab-citas").hidden = name !== "citas";
    if (name === "citas") loadAppointments();
  }

  // =====================================================================
  //  Calendario
  // =====================================================================
  async function loadMonth() {
    const from = new Date(viewYear, viewMonth, 1);
    const to = new Date(viewYear, viewMonth + 1, 1);
    const { data, error } = await sb.from("slots").select("*")
      .gte("starts_at", from.toISOString()).lt("starts_at", to.toISOString()).order("starts_at").limit(2000);
    if (error) return toast("Error al cargar el calendario");
    monthSlots = new Map();
    for (const s of data) {
      const d = new Date(s.starts_at);
      const k = dayKey(d);
      if (!monthSlots.has(k)) monthSlots.set(k, new Map());
      monthSlots.get(k).set(timeKey(d), s);
    }
    renderCalendar(); renderDay();
  }

  function renderCalendar() {
    const first = new Date(viewYear, viewMonth, 1);
    $("#monthTitle").textContent = first.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
    $("#prevM").disabled = viewYear === today0.getFullYear() && viewMonth === today0.getMonth();

    const grid = $("#calGrid"); grid.innerHTML = "";
    ["L", "M", "X", "J", "V", "S", "D"].forEach((d) => { const e = document.createElement("div"); e.className = "cal-dow"; e.textContent = d; grid.appendChild(e); });
    const offset = (first.getDay() + 6) % 7;
    for (let i = 0; i < offset; i++) grid.appendChild(document.createElement("div"));
    const days = new Date(viewYear, viewMonth + 1, 0).getDate();
    for (let n = 1; n <= days; n++) {
      const d = new Date(viewYear, viewMonth, n);
      const k = dayKey(d);
      const m = monthSlots.get(k);
      let free = 0, booked = 0;
      m?.forEach((s) => (s.status === "booked" ? booked++ : free++));
      const b = document.createElement("button");
      b.className = "cal-day" + (dayKey(d) === dayKey(today0) ? " today" : "") + (dayKey(d) === dayKey(selected) ? " sel" : "");
      b.disabled = d < today0;
      b.innerHTML = `${n}<span class="dots">${free ? '<i class="dot"></i>' : ""}${booked ? '<i class="dot b"></i>' : ""}</span>`;
      b.onclick = () => { selected = d; renderCalendar(); renderDay(); };
      grid.appendChild(b);
    }
  }

  $("#prevM").onclick = () => { viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } loadMonth(); };
  $("#nextM").onclick = () => { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } loadMonth(); };

  // ---------- panel del día ----------
  function slotDate(day, h, m) { return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0); }

  function renderDay() {
    $("#dayTitle").textContent = fmtLong(selected);
    $("#wdName").textContent = selected.toLocaleDateString("es-ES", { weekday: "long" }) + "s";
    const m = monthSlots.get(dayKey(selected));
    const box = $("#slots"); box.innerHTML = "";
    const now = new Date();
    for (const [h, mi] of TIMES) {
      const d = slotDate(selected, h, mi);
      const k = `${pad(h)}:${pad(mi)}`;
      const s = m?.get(k);
      const b = document.createElement("button");
      b.className = "slot" + (s ? " " + s.status : "");
      b.innerHTML = s?.status === "booked" ? `${k}<small>${escapeHtml(s.client_name)}</small>` : k;
      if (d <= now) { b.classList.add("past"); b.disabled = true; }
      else b.onclick = () => toggleSlot(d, s);
      box.appendChild(b);
    }
  }

  async function toggleSlot(d, s) {
    if (s?.status === "booked") return toast("Esa hora ya tiene cliente. Cancélala desde la pestaña Citas.");
    if (s) {
      const { error } = await sb.from("slots").delete().eq("id", s.id).eq("status", "free");
      if (error) return toast("No se ha podido quitar la hora");
    } else {
      const { error } = await sb.from("slots").insert({ starts_at: d.toISOString() });
      if (error) return toast("No se ha podido habilitar la hora");
    }
    await loadMonth();
  }

  // ---------- atajos ----------
  document.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => quick(b.dataset.q)));
  async function quick(kind) {
    const now = new Date();
    if (kind === "clear") {
      const from = slotDate(selected, 0, 0), to = slotDate(selected, 23, 59);
      const { error } = await sb.from("slots").delete().eq("status", "free").gte("starts_at", from.toISOString()).lte("starts_at", to.toISOString());
      if (error) return toast("No se han podido quitar las horas");
      toast("Horas libres quitadas");
      return loadMonth();
    }
    const rows = TIMES.filter(([h]) => kind === "all" || (kind === "morning" ? h < 14 : h >= 16))
      .map(([h, m]) => slotDate(selected, h, m)).filter((d) => d > now)
      .map((d) => ({ starts_at: d.toISOString() }));
    if (!rows.length) return toast("No hay horas que añadir en ese tramo");
    const { error } = await sb.from("slots").upsert(rows, { onConflict: "starts_at", ignoreDuplicates: true });
    if (error) return toast("No se han podido habilitar las horas");
    loadMonth();
  }

  $("#repeatBtn").onclick = async () => {
    const m = monthSlots.get(dayKey(selected));
    if (!m || !m.size) return toast("Primero habilita alguna hora en este día");
    const times = [...m.keys()].map((k) => k.split(":").map(Number));
    const rows = [];
    for (let w = 1; w <= 4; w++) {
      const day = new Date(selected); day.setDate(selected.getDate() + 7 * w);
      for (const [h, mi] of times) rows.push({ starts_at: slotDate(day, h, mi).toISOString() });
    }
    const btn = $("#repeatBtn"); btn.disabled = true;
    const { error } = await sb.from("slots").upsert(rows, { onConflict: "starts_at", ignoreDuplicates: true });
    btn.disabled = false;
    if (error) return toast("No se ha podido repetir el horario");
    toast("Horario repetido en las próximas 4 semanas");
    loadMonth();
  };

  // =====================================================================
  //  Citas
  // =====================================================================
  async function loadAppointments() {
    const { data, error } = await sb.from("slots").select("*")
      .eq("status", "booked").gte("starts_at", new Date().toISOString()).order("starts_at").limit(500);
    if (error) return toast("Error al cargar las citas");

    // resaltar citas nuevas llegadas en directo
    const ids = new Set(data.map((s) => s.id));
    const fresh = new Set();
    if (knownBooked) for (const id of ids) if (!knownBooked.has(id)) fresh.add(id);
    knownBooked = ids;
    if (fresh.size) {
      const s = data.find((x) => fresh.has(x.id));
      toast(`🔔 Nueva cita: ${s.client_name} · ${timeKey(new Date(s.starts_at))}`);
    }
    upcoming = data;
    renderAppointments(fresh);
    const badge = $("#badge"); badge.hidden = !data.length; badge.textContent = data.length;
  }

  function renderAppointments(fresh = new Set()) {
    const box = $("#appts");
    if (!upcoming.length) { box.innerHTML = `<div class="state-msg">No tienes citas próximas por ahora.</div>`; return; }
    const groups = new Map();
    for (const s of upcoming) {
      const k = dayKey(new Date(s.starts_at));
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    box.innerHTML = "";
    for (const [, list] of groups) {
      const sec = document.createElement("div"); sec.className = "appt-day";
      sec.innerHTML = `<h3>${fmtLong(new Date(list[0].starts_at))}</h3>`;
      for (const s of list) {
        const el = document.createElement("div");
        el.className = "appt" + (fresh.has(s.id) ? " new" : "");
        el.innerHTML = `<div class="t">${timeKey(new Date(s.starts_at))}</div>
          <div class="who"><b>${escapeHtml(s.client_name)}</b><a href="tel:${escapeHtml(s.client_phone)}">${escapeHtml(s.client_phone)}</a></div>
          <button class="btn small danger">Eliminar</button>`;
        $("button", el).onclick = () => confirmDelete(s);
        sec.appendChild(el);
      }
      box.appendChild(sec);
    }
  }

  function confirmDelete(s) {
    const d = new Date(s.starts_at);
    const o = document.createElement("div"); o.className = "overlay";
    o.innerHTML = `<div class="modal">
      <button class="x" aria-label="Cerrar">×</button>
      <h3>Eliminar cita</h3>
      <p class="sub"><b>${escapeHtml(s.client_name)}</b> · ${fmtLong(d)} a las ${timeKey(d)}</p>
      <div class="actions" style="flex-direction:column;align-items:stretch">
        <button class="btn danger" data-a="free">Cancelar y dejar la hora libre</button>
        <button class="btn ghost" data-a="remove">Cancelar y quitar la hora</button>
        <button class="linkbtn" data-a="no">No, mantener la cita</button>
      </div></div>`;
    document.body.appendChild(o);
    const close = () => o.remove();
    $(".x", o).onclick = close;
    o.onmousedown = (e) => { if (e.target === o) close(); };
    o.querySelectorAll("[data-a]").forEach((b) => (b.onclick = async () => {
      const a = b.dataset.a;
      if (a === "no") return close();
      b.disabled = true;
      const q = a === "free"
        ? sb.from("slots").update({ status: "free", client_name: null, client_phone: null, booked_at: null }).eq("id", s.id)
        : sb.from("slots").delete().eq("id", s.id);
      const { error } = await q;
      close();
      if (error) return toast("No se ha podido eliminar la cita");
      toast("Cita eliminada");
      loadAppointments(); loadMonth();
    }));
  }

  // =====================================================================
  //  Tiempo real
  // =====================================================================
  function subscribeRealtime() {
    if (channel) return;
    channel = sb.channel("slots-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "slots" }, () => { loadAppointments(); loadMonth(); })
      .subscribe();
  }

  // =====================================================================
  //  Notificaciones push (PWA)
  // =====================================================================
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;

  function urlB64ToUint8(b64) {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  async function setupPush() {
    const banner = $("#pushBanner"), text = $("#pushText"), btn = $("#pushBtn");
    if ("serviceWorker" in navigator) {
      try { await navigator.serviceWorker.register("sw.js"); } catch (e) { console.warn("SW", e); }
    }
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported || cfg.VAPID_PUBLIC_KEY.startsWith("TU_")) {
      if (isIOS && !standalone) {
        banner.hidden = false; btn.hidden = true;
        text.innerHTML = "<b>Para recibir avisos en iPhone</b>, pulsa Compartir → «Añadir a pantalla de inicio» y abre el panel desde ese icono.";
      }
      return;
    }
    if (isIOS && !standalone) {
      banner.hidden = false; btn.hidden = true;
      text.innerHTML = "<b>Para recibir avisos en iPhone</b>, pulsa Compartir → «Añadir a pantalla de inicio» y abre el panel desde ese icono.";
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing && Notification.permission === "granted") {
      await saveSub(existing);          // asegura que esté guardada
      banner.hidden = true; return;
    }
    if (Notification.permission === "denied") {
      banner.hidden = false; btn.hidden = true;
      text.innerHTML = "Las notificaciones están bloqueadas en este navegador. Actívalas en los ajustes del sitio para recibir avisos de nuevas citas.";
      return;
    }
    banner.hidden = false; btn.hidden = false;
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") { toast("Permiso de notificaciones no concedido"); btn.disabled = false; return; }
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(cfg.VAPID_PUBLIC_KEY) });
        await saveSub(sub);
        banner.hidden = true;
        toast("✅ Notificaciones activadas en este dispositivo");
      } catch (e) {
        console.error(e); toast("No se han podido activar las notificaciones"); btn.disabled = false;
      }
    };
  }

  async function saveSub(sub) {
    const j = sub.toJSON();
    const { error } = await sb.from("push_subscriptions")
      .upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" });
    if (error) console.error("push sub", error);
  }

  boot();
})();
