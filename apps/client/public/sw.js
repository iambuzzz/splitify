/* Splitify's service worker: notifications only (Web Push). It caches nothing, so the website still
   loads fresh on every visit and updates the same way as before.
   A push carries {title, body, url, tag}. When Splitify is open and in front, the screen already
   shows the change, so nothing pops up. Tapping a notification opens (or focuses) the right screen. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // Safari requires a notification for every push; others don't mind skipping one we'd show twice.
      const seen = wins.some((w) => w.focused && w.visibilityState === 'visible');
      const isSafari = /^((?!chrome|android).)*safari/i.test(self.navigator.userAgent);
      if (seen && !isSafari) return;
      return self.registration.showNotification(data.title || 'Splitify', {
        body: data.body || '',
        tag: data.tag,
        renotify: Boolean(data.tag),
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url: data.url || '/groups' },
      });
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/groups', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // An open Splitify window: bring it forward; the app moves to the screen itself (no reload).
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
          w.postMessage({ type: 'splitify:open', url: new URL(url).pathname + new URL(url).search });
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
