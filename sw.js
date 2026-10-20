/* Service worker: recibe las notificaciones push y hace la web instalable (PWA) */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Necesario para que algunos navegadores ofrezcan "Instalar app"; no cachea nada.
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data && event.data.text() }; }
  const title = data.title || "CMH Barbers";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "Tienes una nueva cita.",
      icon: self.registration.scope + "icon-192.png",
      badge: self.registration.scope + "favicon.png",
      data: { url: data.url || "./admin.html#citas" },
      tag: "nueva-cita",
      renotify: true,
      vibrate: [120, 60, 120],
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "./admin.html#citas", self.registration.scope).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes("admin.html")) { await c.focus(); if ("navigate" in c) c.navigate(target); return; }
    }
    await self.clients.openWindow(target);
  })());
});
