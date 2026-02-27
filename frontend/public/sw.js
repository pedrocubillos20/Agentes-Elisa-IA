// =============================================
// 🔔 BizonneCRM Service Worker v2.0
// PWA install + offline shell + PUSH NOTIFICATIONS
// =============================================
const CACHE_NAME = 'bizonne-v2';
const OFFLINE_URL = '/dashboard';

// Pre-cache essential assets on install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/dashboard',
        '/bizonne.png'
      ]).catch(() => {});
    })
  );
  self.skipWaiting();
});

// Clean old caches on activate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first strategy
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) return;
  
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          return cached || caches.match(OFFLINE_URL);
        });
      })
  );
});

// =============================================
// 🔔 PUSH NOTIFICATION HANDLER
// This runs even when the app/browser is CLOSED
// =============================================
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = {
      title: 'BizonneCRM',
      body: event.data.text() || 'Nueva notificación',
      icon: '/bizonne.png'
    };
  }

  const options = {
    body: data.body || '',
    icon: data.icon || '/bizonne.png',
    badge: data.badge || '/bizonne.png',
    tag: data.tag || 'bizonne-' + Date.now(),
    vibrate: data.vibrate || [200, 100, 200],
    requireInteraction: data.requireInteraction !== false,
    timestamp: data.timestamp || Date.now(),
    data: {
      url: data.url || '/conversaciones',
      dateOfArrival: Date.now()
    },
    actions: data.actions || [
      { action: 'open', title: '📱 Abrir' },
      { action: 'dismiss', title: '✕ Cerrar' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'BizonneCRM', options)
  );
});

// =============================================
// 👆 NOTIFICATION CLICK — Abre la app
// =============================================
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action = event.action;
  if (action === 'dismiss') return;

  // Get the URL from the notification data
  const urlToOpen = event.notification.data?.url || '/conversaciones';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a window is already open, focus it and navigate
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.navigate(urlToOpen);
          return;
        }
      }
      // Otherwise, open a new window
      return clients.openWindow(urlToOpen);
    })
  );
});

// =============================================
// 🔄 PUSH SUBSCRIPTION CHANGE — Auto-resubscribe
// =============================================
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe(event.oldSubscription.options).then((subscription) => {
      // Re-register with backend
      return fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() })
      });
    })
  );
});
