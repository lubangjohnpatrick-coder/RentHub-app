/* GoRentHive service worker - deployment-safe PWA */
const CACHE = 'gorenthive-v4-launch-ready';
const APP_SHELL = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/css/launch-ready.css',
  '/js/vendor/supabase.js',
  '/js/supabase-config.js',
  '/js/api.js',
  '/js/app.js',
  '/js/location-hardening.js',
  '/js/launch-ready.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isAppCode(pathname) {
  return pathname === '/' || pathname === '/index.html' || /\.(js|css|html|webmanifest)$/.test(pathname);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;

  // Network-first for HTML/JS/CSS so deployments are visible immediately.
  if (isAppCode(url.pathname)) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res && res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(e.request).then((cached) => cached || caches.match('/index.html')))
    );
    return;
  }

  // Cache-first is fine for icons/static images.
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
      if (res && res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
      return res;
    }))
  );
});

self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(data.title || 'GoRentHive', {
    body: data.body || 'New update',
    icon: '/icons/icon-192.png',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cls) => {
    for (const c of cls) {
      if ('focus' in c) { c.focus(); c.navigate(e.notification.data.url || '/'); return; }
    }
    clients.openWindow(e.notification.data.url || '/');
  }));
});