// Retire the original Churches Cup worker, which cached the old homepage.
// Keep this URL available so installed copies can update during the cutover.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith("churches-cup-"))
      .map((name) => caches.delete(name)));

    await self.clients.claim();
    await self.registration.unregister();

    const windows = await self.clients.matchAll({ type: "window" });
    await Promise.allSettled(windows.map((client) => {
      const url = new URL(client.url);
      if (url.pathname === "/index.html") url.pathname = "/";
      return client.navigate(url.href);
    }));
  })());
});
