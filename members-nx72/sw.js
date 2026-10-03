/* הכתובת הזו הועברה ל-members-k38p. ה-Service Worker הישן מוחק את המטמון ומבטל את עצמו. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k))))
      .then(() => self.registration.unregister())
  );
});
