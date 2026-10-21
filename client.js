/* CMH Barbers · parte del cliente */
(() => {
  const cfg = window.CMH;
  // Esta página es PÚBLICA: nunca usa la sesión del admin, aunque esté abierta en el mismo navegador.
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
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
  const LOCS = { badajoz: "Badajoz", barcarrota: "Barcarrota" };
  let filterLoc = "any";
  try { const v = localStorage.getItem("cmh-loc"); if (v === "badajoz" || v === "barcarrota" || v === "any") filterLoc = v; } catch (_) {}

  // ---------- carga de horas libres ----------
  async function load(silent = false) {
    const until = new Date(); until.setDate(until.getDate() + cfg.DAYS_AHEAD + 1);
    const { data, error } = await sb.rpc("get_available_slots");
    if (error) {
      console.error("get_available_slots", error);
      if (!silent) setState("No se han podido cargar las horas. Recarga la página en unos segundos. (" + (error.code || error.message || "error") + ")");
      return;
    }
    byDay = new Map();
    for (const r of data) {
      const d = new Date(r.starts_at);
      if (d >= until) continue;
      const k = dayKey(d);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push({ id: r.id, date: d, loc: r.location });
    }
    render();
  }

  function setState(msg) {
    const s = $("#state"); s.textContent = msg; s.hidden = !msg;
    $("#picker").hidden = !!msg;
  }

  function renderLocPick() {
    const opts = [["any", "Me da igual"], ["badajoz", "Badajoz"], ["barcarrota", "Barcarrota"]];
    const box = $("#locPick");
    box.innerHTML = `<span class="loc-label">¿Dónde quieres pelarte?</span><div class="loc-btns">` +
      opts.map(([k, v]) => `<button type="button" class="loc-btn${filterLoc === k ? " on" : ""}" data-k="${k}">${k === "any" ? "" : "📍 "}${v}</button>`).join("") + `</div>`;
    box.onclick = (e) => {
      const b = e.target.closest("[data-k]"); if (!b) return;
      filterLoc = b.dataset.k; selectedDay = null;
      try { localStorage.setItem("cmh-loc", filterLoc); } catch (_) {}
      render();
    };
  }

  function render() {
    setState("");
    renderLocPick();
    const vis = (arr) => arr.filter((s) => filterLoc === "any" || s.loc === filterLoc);

    const daysEl = $("#days"); daysEl.innerHTML = "";
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const keys = [];
    let firstWithSlots = null, total = 0;
    for (let i = 0; i <= cfg.DAYS_AHEAD; i++) {
      const d = new Date(today); d.setDate(today.getDate() + i);
      const k = dayKey(d); keys.push(k);
      const list = vis(byDay.get(k) || []);
      const n = list.length; total += n;
      if (n && !firstWithSlots) firstWithSlots = k;
      const locs = [...new Set(list.map((s) => s.loc))].map((l) => LOCS[l]).join(" · ");
      const b = document.createElement("button");
      b.className = "day" + (n ? "" : " empty");
      b.disabled = !n;
      b.dataset.k = k;
      b.innerHTML = `<span class="dow">${d.toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "")}</span>
        <span class="num">${d.getDate()}</span>
        <span class="mon">${d.toLocaleDateString("es-ES", { month: "short" }).replace(".", "")}</span>
        <span class="cnt">${n ? n + (n === 1 ? " hora" : " horas") : "—"}</span>
        ${n ? `<span class="where">${locs}</span>` : ""}`;
      b.onclick = () => { selectedDay = k; render(); };
      daysEl.appendChild(b);
    }

    const timesEl = $("#times"); timesEl.innerHTML = "";
    if (!total) {
      daysEl.hidden = true; $("#timesTitle").textContent = "";
      timesEl.innerHTML = `<div class="state-msg" style="grid-column:1/-1">${filterLoc === "any"
        ? "Ahora mismo no hay horas libres. Vuelve a mirar pronto."
        : `Ahora mismo no hay horas libres en ${LOCS[filterLoc]}. Prueba con otra sede o «Me da igual».`}</div>`;
      return;
    }
    daysEl.hidden = false;
    if (!selectedDay || !keys.includes(selectedDay) || !vis(byDay.get(selectedDay) || []).length) selectedDay = firstWithSlots;
    [...daysEl.children].forEach((el) => el.classList.toggle("sel", el.dataset.k === selectedDay));

    const slots = vis(byDay.get(selectedDay) || []);
    const multi = new Set(slots.map((s) => s.loc)).size > 1;
    const where = [...new Set(slots.map((s) => LOCS[s.loc]))].join(" · ");
    $("#timesTitle").textContent = `Horas libres · ${fmtLong(slots[0].date)} · 📍 ${where}`;
    for (const s of slots) {
      const b = document.createElement("button");
      b.className = "time"; b.textContent = fmtTime(s.date) + (multi ? ` · ${LOCS[s.loc]}` : "");
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
      <div class="chosen">📅 ${fmtLong(slot.date)} · <b>${fmtTime(slot.date)}</b> · 📍 ${LOCS[slot.loc] || ""}</div>
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
      sb.functions.invoke("notify", { body: { slot_id: slot.id } })
        .then((r) => console.log("notify:", r.data || r.error)).catch((e) => console.warn("notify", e));
      stepDone(new Date(data || slot.date), fn, slot.loc);
      load(true);
    };
  }

  function stepDone(date, name, loc) {
    const o = openModal(`
      <div class="done">
        <div class="tick">✓</div>
        <h3>¡Cita confirmada!</h3>
        <div class="when">${fmtLong(date)}</div>
        <div class="when"><b>${fmtTime(date)}</b> · ${LOCS[loc] || ""}</div>
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
