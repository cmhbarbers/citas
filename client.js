/* CMH Barbers · parte del cliente */
(() => {
  const cfg = window.CMH;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const $ = (s, r = document) => r.querySelector(s);

  document.getElementById("yr").textContent = new Date().getFullYear();
  addEventListener("scroll", () => $("#topbar").classList.toggle("solid", scrollY > 30), { passive: true });

  // ---------- utilidades de fecha ----------
  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const fmtLong = (d) => d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });

  let byDay = new Map();   // "2026-10-20" -> [{id, date}]
  let selectedDay = null;

  // ---------- carga de horas libres ----------
  async function load(silent = false) {
    const until = new Date(); until.setDate(until.getDate() + cfg.DAYS_AHEAD + 1);
    const { data, error } = await sb.from("available_slots")
      .select("id,starts_at").lt("starts_at", until.toISOString()).order("starts_at").limit(1000);
    if (error) {
      if (!silent) setState("No se han podido cargar las horas. Recarga la página en unos segundos.");
      return;
    }
    byDay = new Map();
    for (const r of data) {
      const d = new Date(r.starts_at);
      const k = dayKey(d);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push({ id: r.id, date: d });
    }
    render();
  }

  function setState(msg) {
    const s = $("#state"); s.textContent = msg; s.hidden = !msg;
    $("#picker").hidden = !!msg;
  }

  function render() {
    if (byDay.size === 0) { setState("Ahora mismo no hay horas libres. Vuelve a mirar pronto."); return; }
    setState("");

    // Tira de días
    const daysEl = $("#days"); daysEl.innerHTML = "";
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let firstWithSlots = null;
    for (let i = 0; i <= cfg.DAYS_AHEAD; i++) {
      const d = new Date(today); d.setDate(today.getDate() + i);
      const k = dayKey(d);
      const n = (byDay.get(k) || []).length;
      if (n && !firstWithSlots) firstWithSlots = k;
      const b = document.createElement("button");
      b.className = "day" + (n ? "" : " empty") + (k === selectedDay ? " sel" : "");
      b.disabled = !n;
      b.innerHTML = `<span class="dow">${d.toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "")}</span>
        <span class="num">${d.getDate()}</span>
        <span class="mon">${d.toLocaleDateString("es-ES", { month: "short" }).replace(".", "")}</span>
        <span class="cnt">${n ? n + (n === 1 ? " hora" : " horas") : "—"}</span>`;
      b.onclick = () => { selectedDay = k; render(); };
      daysEl.appendChild(b);
    }
    if (!selectedDay || !byDay.has(selectedDay)) selectedDay = firstWithSlots;
    // marcar seleccionado tras posible cambio
    [...daysEl.children].forEach((el, i) => {
      const d = new Date(today); d.setDate(today.getDate() + i);
      el.classList.toggle("sel", dayKey(d) === selectedDay);
    });

    // Horas del día
    const slots = byDay.get(selectedDay) || [];
    const sd = slots[0]?.date;
    $("#timesTitle").textContent = sd ? `Horas libres · ${fmtLong(sd)}` : "";
    const timesEl = $("#times"); timesEl.innerHTML = "";
    for (const s of slots) {
      const b = document.createElement("button");
      b.className = "time"; b.textContent = fmtTime(s.date);
      b.onclick = () => openBooking(s);
      timesEl.appendChild(b);
    }
  }

  // ---------- modal de reserva ----------
  let modalOpen = false;
  function openModal(html) {
    closeModal();
    const o = document.createElement("div");
    o.className = "overlay"; o.id = "overlay";
    o.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    o.addEventListener("mousedown", (e) => { if (e.target === o) closeModal(); });
    document.body.appendChild(o);
    document.body.style.overflow = "hidden";
    modalOpen = true;
    return o;
  }
  function closeModal() {
    $("#overlay")?.remove();
    document.body.style.overflow = "";
    modalOpen = false;
  }
  addEventListener("keydown", (e) => { if (e.key === "Escape" && modalOpen) closeModal(); });

  function toast(msg) {
    const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 3800);
  }

  function openBooking(slot) {
    const o = openModal(`
      <button class="x" aria-label="Cerrar">×</button>
      <h3>Reserva tu cita</h3>
      <p class="sub">Solo necesitamos tu nombre y un teléfono de contacto.</p>
      <div class="chosen">📅 ${fmtLong(slot.date)} · <b>${fmtTime(slot.date)}</b></div>
      <form id="f1" novalidate>
        <div class="row2">
          <label class="field"><span>Nombre</span><input name="fn" autocomplete="given-name" maxlength="40" required></label>
          <label class="field"><span>Apellidos</span><input name="ln" autocomplete="family-name" maxlength="60" required></label>
        </div>
        <label class="field"><span>Teléfono móvil</span><input name="ph" type="tel" inputmode="tel" autocomplete="tel" placeholder="612 345 678" maxlength="20" required></label>
        <div class="err" id="e1"></div>
        <div class="actions"><button class="btn" id="send" type="submit">Confirmar cita</button></div>
        <p class="fine">Usaremos tu teléfono solo para gestionar esta cita.</p>
      </form>`);
    $(".x", o).onclick = closeModal;
    $("input[name=fn]", o).focus();

    $("#f1", o).onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target, err = $("#e1", o), btn = $("#send", o);
      err.textContent = "";
      const fn = f.fn.value.trim(), ln = f.ln.value.trim(), ph = f.ph.value.trim();
      if (fn.length < 2 || ln.length < 2) return (err.textContent = "Escribe tu nombre y apellidos.");
      if (!/^(\+|00)?[\d\s\-().]{9,18}$/.test(ph) || ph.replace(/\D/g, "").length < 9) return (err.textContent = "Escribe un teléfono válido.");
      btn.disabled = true; btn.textContent = "Reservando…";

      const { data, error } = await sb.rpc("book_slot", { p_slot: slot.id, p_name: `${fn} ${ln}`, p_phone: ph });
      if (error) {
        btn.disabled = false; btn.textContent = "Confirmar cita";
        const m = error.message || "";
        if (m.includes("SLOT_TAKEN")) { err.textContent = "Alguien se te ha adelantado: esa hora ya está cogida."; setTimeout(() => { closeModal(); load(true); }, 1800); }
        else if (m.includes("LIMIT_REACHED")) err.textContent = "Ya tienes 2 citas pendientes con este teléfono.";
        else if (m.includes("BAD_PHONE")) err.textContent = "El teléfono no es válido.";
        else if (m.includes("BAD_NAME")) err.textContent = "Escribe tu nombre y apellidos.";
        else err.textContent = "No se ha podido reservar. Inténtalo de nuevo.";
        return;
      }
      // Avisa al peluquero (push). Si falla, la cita ya está reservada igualmente.
      try { sb.functions.invoke("notify", { body: { slot_id: slot.id } }); } catch (_) {}
      stepDone(new Date(data || slot.date), fn);
      load(true);
    };
  }

  function stepDone(date, name) {
    const o = openModal(`
      <div class="done">
        <div class="tick">✓</div>
        <h3>¡Cita confirmada!</h3>
        <div class="when">${fmtLong(date)}</div>
        <div class="when"><b>${fmtTime(date)}</b></div>
        <p style="margin-top:10px">Te esperamos, ${escapeHtml(name)}. Si no puedes venir, avísanos con tiempo.</p>
        <button class="btn" id="fin">Perfecto</button>
      </div>`);
    $("#fin", o).onclick = closeModal;
  }

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- arranque ----------
  load();
  setInterval(() => { if (!modalOpen && !document.hidden) load(true); }, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !modalOpen) load(true); });
})();
