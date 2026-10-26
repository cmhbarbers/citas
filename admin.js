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
  let quietUntil = 0;              // evita el aviso «Nueva cita» cuando la añade el propio admin
  const LOCS = { badajoz: "Badajoz", barcarrota: "Barcarrota" };
  const chosenLoc = new Map();     // dayKey -> sede elegida en días aún sin horas
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

  function dayLoc(day) {
    const k = dayKey(day), m = monthSlots.get(k);
    if (m && m.size) return [...m.values()][0].location;
    return chosenLoc.get(k) || null;
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
      const lc = m && m.size ? [...m.values()][0].location : chosenLoc.get(k);
      b.innerHTML = `${lc ? `<em class="loc-tag ${lc}">${lc === "badajoz" ? "BA" : "BC"}</em>` : ""}${n}<span class="dots">${free ? '<i class="dot"></i>' : ""}${booked ? '<i class="dot b"></i>' : ""}</span>`;
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
    { const w = selected.toLocaleDateString("es-ES", { weekday: "long" }); $("#wdName").textContent = w.endsWith("s") ? w : w + "s"; }
    const m = monthSlots.get(dayKey(selected));
    const loc = dayLoc(selected);
    const hasBooked = [...(m?.values() || [])].some((s) => s.status === "booked");

    $("#locSeg").innerHTML = Object.entries(LOCS).map(([k, v]) =>
      `<button type="button" class="seg-btn${loc === k ? " on" : ""}" data-loc="${k}"${hasBooked && loc !== k ? " disabled" : ""}>📍 ${v}</button>`).join("");
    $("#dayHint").textContent = !loc
      ? "Elige primero dónde vas a pelar este día."
      : hasBooked
        ? `Este día pelas en ${LOCS[loc]} (ya hay citas, no se puede cambiar de sitio). Toca una hora para habilitarla o quitarla.`
        : `Este día pelas en ${LOCS[loc]}. Toca una hora para habilitarla (verde) o quitarla. Las rojas ya las ha cogido un cliente.`;

    const box = $("#slots"); box.innerHTML = "";
    box.classList.toggle("needloc", !loc);
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

  $("#locSeg").onclick = (e) => {
    const b = e.target.closest("[data-loc]");
    if (b && !b.disabled) setLoc(b.dataset.loc);
  };

  async function setLoc(loc) {
    const k = dayKey(selected), m = monthSlots.get(k);
    if (m && m.size) {
      if ([...m.values()].some((s) => s.status === "booked") && dayLoc(selected) !== loc)
        return toast("Este día ya tiene citas. Cancélalas para cambiar de sede.");
      const from = slotDate(selected, 0, 0), to = slotDate(selected, 23, 59);
      const { error } = await sb.from("slots").update({ location: loc }).eq("status", "free")
        .gte("starts_at", from.toISOString()).lte("starts_at", to.toISOString());
      if (error) return toast("No se ha podido cambiar la sede");
      toast(`Sede del día: ${LOCS[loc]}`);
      return loadMonth();
    }
    chosenLoc.set(k, loc);
    renderCalendar(); renderDay();
  }

  const needLoc = () => { toast("Elige primero Badajoz o Barcarrota para este día"); };

  async function toggleSlot(d, s) {
    if (s?.status === "booked") return toast("Esa hora ya tiene cliente. Cancélala desde la pestaña Citas.");
    if (s) {
      const { error } = await sb.from("slots").delete().eq("id", s.id).eq("status", "free");
      if (error) return toast("No se ha podido quitar la hora");
    } else {
      const loc = dayLoc(d);
      if (!loc) return needLoc();
      const { error } = await sb.from("slots").insert({ starts_at: d.toISOString(), location: loc });
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
    const loc = dayLoc(selected);
    if (!loc) return needLoc();
    const rows = TIMES.filter(([h]) => kind === "all" || (kind === "morning" ? h < 14 : h >= 16))
      .map(([h, m]) => slotDate(selected, h, m)).filter((d) => d > now)
      .map((d) => ({ starts_at: d.toISOString(), location: loc }));
    if (!rows.length) return toast("No hay horas que añadir en ese tramo");
    const { error } = await sb.from("slots").upsert(rows, { onConflict: "starts_at", ignoreDuplicates: true });
    if (error) return toast("No se han podido habilitar las horas");
    loadMonth();
  }

  $("#repeatBtn").onclick = async () => {
    const m = monthSlots.get(dayKey(selected));
    if (!m || !m.size) return toast("Primero habilita alguna hora en este día");
    const loc = dayLoc(selected);
    const times = [...m.keys()].map((k) => k.split(":").map(Number));
    const rows = [];
    for (let w = 1; w <= 4; w++) {
      const day = new Date(selected); day.setDate(selected.getDate() + 7 * w);
      for (const [h, mi] of times) rows.push({ starts_at: slotDate(day, h, mi).toISOString(), location: loc });
    }
    const btn = $("#repeatBtn"); btn.disabled = true;
    const { error } = await sb.from("slots").upsert(rows, { onConflict: "starts_at", ignoreDuplicates: true });
    btn.disabled = false;
    if (error) return toast("No se ha podido repetir el horario");
    toast(`Horario repetido en ${LOCS[loc]} las próximas 4 semanas`);
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
    if (fresh.size && Date.now() > quietUntil) {
      const s = data.find((x) => fresh.has(x.id));
      toast(`🔔 Nueva cita: ${s.client_name} · ${timeKey(new Date(s.starts_at))} · ${LOCS[s.location] || ""}`);
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
          <div class="who"><b>${escapeHtml(s.client_name)}</b><span class="loc-pill ${s.location}">📍 ${LOCS[s.location] || ""}</span> ${s.client_phone ? `<a href="tel:${escapeHtml(s.client_phone)}">${escapeHtml(s.client_phone)}</a>` : `<span class="nophone">Sin teléfono</span>`}</div>
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
      <p class="sub"><b>${escapeHtml(s.client_name)}</b> · ${fmtLong(d)} a las ${timeKey(d)} · ${LOCS[s.location] || ""}</p>
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
  //  Añadir cita manualmente (cliente que escribe por WhatsApp, en persona…)
  // =====================================================================
  $("#addManual").onclick = () => openManual(selected);
  $("#addManual2").onclick = () => openManual(selected);

  function openManual(initialDay) {
    const o = document.createElement("div"); o.className = "overlay";
    o.innerHTML = `<div class="modal">
      <button class="x" aria-label="Cerrar">×</button>
      <h3>Añadir cita</h3>
      <p class="sub">Para un cliente que te ha escrito por WhatsApp o en persona. No recibirá ningún SMS.</p>
      <div class="row2">
        <label class="field"><span>Día</span><input type="date" id="mDate" min="${dayKey(today0)}" value="${dayKey(initialDay < today0 ? today0 : initialDay)}"></label>
        <label class="field"><span>Hora</span><select id="mTime"></select></label>
      </div>
      <div class="field"><span>Sede</span><div class="loc-seg" id="mLoc"></div></div>
      <label class="field"><span>Nombre y apellidos</span><input id="mName" maxlength="80" autocomplete="off"></label>
      <label class="field"><span>Teléfono (opcional)</span><input id="mPhone" type="tel" inputmode="tel" maxlength="20" placeholder="612 345 678" autocomplete="off"></label>
      <div class="err" id="mErr"></div>
      <div class="actions"><button class="btn" id="mSave">Guardar cita</button></div>
    </div>`;
    document.body.appendChild(o);
    const close = () => o.remove();
    $(".x", o).onclick = close;
    o.onmousedown = (e) => { if (e.target === o) close(); };
    const dateEl = $("#mDate", o), timeEl = $("#mTime", o), locEl = $("#mLoc", o), errEl = $("#mErr", o), saveBtn = $("#mSave", o);

    let daySlots = new Map(), lockedLoc = null, pickedLoc = null;

    const parseDay = () => { const [y, m, d] = dateEl.value.split("-").map(Number); return y ? new Date(y, m - 1, d) : null; };

    function drawLoc() {
      locEl.innerHTML = Object.entries(LOCS).map(([k, v]) =>
        `<button type="button" class="seg-btn${pickedLoc === k ? " on" : ""}" data-loc="${k}"${lockedLoc && lockedLoc !== k ? " disabled" : ""}>📍 ${v}</button>`).join("");
    }
    locEl.onclick = (e) => { const b = e.target.closest("[data-loc]"); if (b && !b.disabled) { pickedLoc = b.dataset.loc; drawLoc(); } };

    async function loadDay() {
      errEl.textContent = "";
      const day = parseDay();
      timeEl.innerHTML = ""; daySlots = new Map(); lockedLoc = null;
      if (!day || day < today0) { timeEl.innerHTML = `<option value="">—</option>`; drawLoc(); return; }
      const { data, error } = await sb.from("slots").select("*")
        .gte("starts_at", slotDate(day, 0, 0).toISOString()).lte("starts_at", slotDate(day, 23, 59).toISOString());
      if (error) { errEl.textContent = "No se han podido cargar las horas de ese día."; return; }
      for (const s of data) daySlots.set(timeKey(new Date(s.starts_at)), s);
      lockedLoc = data.length ? data[0].location : null;
      pickedLoc = lockedLoc || chosenLoc.get(dayKey(day)) || null;
      const now = new Date();
      const opts = TIMES.filter(([h, mi]) => slotDate(day, h, mi) > now)
        .map(([h, mi]) => ({ k: `${pad(h)}:${pad(mi)}` }))
        .filter(({ k }) => daySlots.get(k)?.status !== "booked");
      timeEl.innerHTML = opts.length
        ? opts.map(({ k }) => `<option value="${k}">${k}${daySlots.has(k) ? " · habilitada" : ""}</option>`).join("")
        : `<option value="">Sin horas disponibles</option>`;
      drawLoc();
    }
    dateEl.onchange = loadDay;
    loadDay();
    $("#mName", o).focus();

    saveBtn.onclick = async () => {
      errEl.textContent = "";
      const day = parseDay(), t = timeEl.value;
      const name = $("#mName", o).value.replace(/\s+/g, " ").trim();
      const phone = $("#mPhone", o).value.replace(/[\s\-().]/g, "");
      if (!day || !t) return (errEl.textContent = "Elige un día y una hora.");
      if (!pickedLoc) return (errEl.textContent = "Elige la sede (Badajoz o Barcarrota).");
      if (name.length < 2) return (errEl.textContent = "Escribe el nombre del cliente.");
      if (phone && !/^(\+|00)?\d{9,15}$/.test(phone)) return (errEl.textContent = "El teléfono no es válido (déjalo vacío si no lo tienes).");

      const [h, mi] = t.split(":").map(Number);
      const when = slotDate(day, h, mi);
      if (when <= new Date()) return (errEl.textContent = "Esa hora ya ha pasado.");

      saveBtn.disabled = true; saveBtn.textContent = "Guardando…";
      quietUntil = Date.now() + 6000;
      const fields = { status: "booked", client_name: name, client_phone: phone || null, booked_at: new Date().toISOString(), notified: true };
      const existing = daySlots.get(t);
      let error;
      if (existing) {
        ({ error } = await sb.from("slots").update(fields).eq("id", existing.id).eq("status", "free"));
      } else {
        ({ error } = await sb.from("slots").insert({ starts_at: when.toISOString(), location: pickedLoc, ...fields }));
      }
      saveBtn.disabled = false; saveBtn.textContent = "Guardar cita";
      if (error) { errEl.textContent = "No se ha podido guardar (¿alguien acaba de coger esa hora?). Prueba con otra."; loadDay(); return; }
      close();
      toast(`✅ Cita añadida: ${name} · ${t} · ${LOCS[pickedLoc]}`);
      await loadAppointments(); await loadMonth();
    };
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
    banner.hidden = false;
    const testBtn = $("#pushTest");
    testBtn.hidden = true;
    const info = (html, showBtn = false, label) => {
      text.innerHTML = html; btn.hidden = !showBtn; btn.disabled = false;
      testBtn.hidden = !(showBtn && label === "Desactivar");
      if (label) btn.textContent = label;
    };
    testBtn.onclick = sendTest;

    if ("serviceWorker" in navigator) {
      try { await navigator.serviceWorker.register("sw.js"); } catch (e) { console.warn("SW", e); }
    }
    if (isIOS && !standalone)
      return info("<b>Para recibir avisos en iPhone</b>: pulsa Compartir → «Añadir a pantalla de inicio» y abre el panel desde ese icono.");
    if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
      return info("Este navegador no admite notificaciones push. Usa Chrome (Android/PC) o Safari 16.4+ con la web añadida a la pantalla de inicio.");
    if (!cfg.VAPID_PUBLIC_KEY || cfg.VAPID_PUBLIC_KEY.startsWith("TU_"))
      return info("<b>Falta la clave VAPID.</b> Pega la clave pública en <code>config.js</code> (<code>VAPID_PUBLIC_KEY</code>) y vuelve a subir el archivo a GitHub (paso 6 de SETUP.md).");
    if (Notification.permission === "denied")
      return info("Las notificaciones están <b>bloqueadas</b> en este navegador. Pulsa el candado de la barra de direcciones → Notificaciones → Permitir, y recarga.");

    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing && Notification.permission === "granted") {
      await saveSub(existing);
      info("✅ <b>Notificaciones activadas</b> en este dispositivo.", true, "Desactivar");
      return wireOff(btn, existing, info, reg);
    }
    info("<b>Recibe un aviso en este dispositivo</b> cada vez que un cliente confirme una cita.", true, "Activar notificaciones");
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") { toast("Permiso de notificaciones no concedido"); btn.disabled = false; return; }
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(cfg.VAPID_PUBLIC_KEY) });
        await saveSub(sub);
        toast("✅ Notificaciones activadas en este dispositivo");
        wireOff(btn, sub, info, reg);
        info("✅ <b>Notificaciones activadas</b> en este dispositivo.", true, "Desactivar");
      } catch (e) {
        console.error(e); toast("No se han podido activar las notificaciones"); btn.disabled = false;
      }
    };
  }

  async function sendTest() {
    const b = $("#pushTest"); b.disabled = true; b.textContent = "Enviando…";
    const { data, error } = await sb.functions.invoke("notify", { body: { test: true } });
    b.disabled = false; b.textContent = "Enviar prueba";
    let res = data;
    if (error) {
      try { res = await error.context.json(); } catch (_) {}
      if (!res) res = { error: error.message || "No se pudo llamar a la función «notify». ¿Está desplegada con Verify JWT desactivado?" };
    }
    console.log("notify test:", res);
    const t = $("#pushText");
    if (res?.sent > 0) {
      t.innerHTML = `✅ <b>Prueba enviada</b> a ${res.sent} de ${res.subscriptions} dispositivo(s). Si no ves nada, revisa los permisos de notificaciones del navegador/sistema.`;
    } else {
      const f = res?.failures?.[0];
      t.innerHTML = `❌ <b>La prueba ha fallado.</b> ${escapeHtml(res?.error || (f ? `El servicio push respondió ${f.status ?? ""}: ${f.message}` : "Sin detalles"))}`;
    }
  }

  function wireOff(btn, sub, info, reg) {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const cur = (await reg.pushManager.getSubscription()) || sub;
        await sb.from("push_subscriptions").delete().eq("endpoint", cur.endpoint);
        await cur.unsubscribe();
      } catch (e) { console.error(e); }
      setupPush();
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
