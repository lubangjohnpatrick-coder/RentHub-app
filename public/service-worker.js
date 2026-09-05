/* GoRentHive service worker — network-first app code, cache-first static media. */
const CACHE = 'gorenthive-v13-current-brand';
const APP_SHELL = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/css/launch-ready.css',
  '/css/app-theme.css',
  '/css/profile-experience.css',
  '/css/experience.css',
  '/js/vendor/supabase.js',
  '/js/supabase-config.js',
  '/js/api.js',
  '/js/app.js',
  '/js/location-hardening.js',
  '/js/launch-ready.js',
  '/js/payment-experience.js',
  '/js/private-media.js',
  '/js/legal-acceptance.js',
  '/js/ui-shell.js',
  '/js/profile-experience.js',
  '/brand/gorenthive-mark.png',
  '/brand/gorenthive-wordmark.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isAppCode(pathname) {
  return pathname === '/' || pathname === '/index.html' || /\.(js|css|html|webmanifest)$/.test(pathname);
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    return (await caches.match(request)) || (await caches.match('/index.html'));
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;
  event.respondWith(isAppCode(url.pathname) ? networkFirst(event.request) : cacheFirst(event.request));
});

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title || 'GoRentHive', {
    body: data.body || 'New update',
    icon: '/brand/gorenthive-mark.png',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    for (const client of windows) {
      if ('focus' in client) {
        client.focus();
        client.navigate(event.notification.data.url || '/');
        return;
      }
    }
    return clients.openWindow(event.notification.data.url || '/');
  }));
});
