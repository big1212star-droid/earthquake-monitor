const CACHE_NAME = 'earthquake-monitor-v1';
const ASSETS = ['/', '/index.html'];

// ===== インストール =====
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ===== アクティベート =====
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ===== フェッチ（オフライン対応） =====
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

// ===== バックグラウンド同期（地震チェック） =====
self.addEventListener('periodicsync', event => {
  if (event.tag === 'earthquake-check') {
    event.waitUntil(checkEarthquake());
  }
});

// ===== プッシュ通知受信 =====
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification('🚨 緊急地震速報', {
      body: data.body,
      icon: 'icon-192.png',
      tag: 'earthquake-alert',
      renotify: true,
      requireInteraction: true,
      vibrate: [300, 100, 300, 100, 300],
    })
  );
});

// ===== 通知クリック =====
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('index.html') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow('/index.html');
    })
  );
});

// ===== バックグラウンドでP2PQuake確認 =====
let lastBgEventId = null;

async function checkEarthquake() {
  try {
    const target = 'https://api.p2pquake.net/v2/history?codes=551&limit=3';
    const res = await fetch(target);
    if (!res.ok) return;
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) return;

    const latest = items[0];
    if (latest.id === lastBgEventId) return;

    const eq = latest.earthquake;
    if (!eq) return;

    const scaleMap = {10:'1',20:'2',30:'3',40:'4',45:'5弱',50:'5強',55:'6弱',60:'6強',70:'7'};
    const scaleNum = {10:1,20:2,30:3,40:4,45:4.5,50:5,55:6,60:6.5,70:7};
    const maxScale = eq.maxScale;
    if (!maxScale || (scaleNum[maxScale] || 0) < 3) return;

    lastBgEventId = latest.id;

    const hypo = eq.hypocenter || {};
    const loc = hypo.name || '不明';
    const mag = hypo.magnitude != null ? hypo.magnitude : '不明';
    const intStr = scaleMap[maxScale] || String(maxScale);

    // フォアグラウンドのページに通知
    const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clientList.length > 0) {
      // ページが開いていれば、ページ側で処理
      clientList.forEach(client => client.postMessage({
        type: 'EARTHQUAKE',
        location: loc, magnitude: mag, maxIntensity: intStr,
        maxScale, eventId: latest.id,
      }));
    } else {
      // バックグラウンドの場合はシステム通知
      await self.registration.showNotification('🚨 緊急地震速報', {
        body: '震源地: ' + loc + '  M' + mag + '  最大震度' + intStr,
        icon: 'icon-192.png',
        tag: 'earthquake-alert',
        renotify: true,
        requireInteraction: true,
        vibrate: [300, 100, 300, 100, 300],
        data: { location: loc, magnitude: mag, maxIntensity: intStr, maxScale, eventId: latest.id },
      });
    }
  } catch(e) {
    console.error('BG check error:', e);
  }
}

// ===== メッセージ受信（メインページからのチェック要求） =====
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'CHECK_NOW') {
    checkEarthquake();
  }
});
