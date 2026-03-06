const CACHE = "paper-story-v1";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.json"])));
  self.skipWaiting();
});
self.addEventListener("fetch", (e) => {
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

self.addEventListener("push", (e) => {
  let data = { title: "Paper Story", body: "Your daily research digest is ready.", url: "/" };
  if (e.data) {
    try {
      data = e.data.json();
    } catch (_) {}
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/manifest.json",
      badge: "/manifest.json",
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      if (list.length) {
        const w = list[0];
        w.navigate(url);
        w.focus();
      } else if (clients.openWindow) {
        clients.openWindow(url);
      }
    })
  );
});
