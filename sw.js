// ふたりの割り勘帳 — Service Worker
const CACHE_NAME = 'warikan-v11';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg',
];

// インストール時にすべてのアセットをキャッシュ
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 新しい SW がアクティブになったら古いキャッシュを削除
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// リクエスト時: キャッシュ優先 → ネットワークにフォールバック
self.addEventListener('fetch', event => {
  // Google Fonts 等の外部リソースはネットワーク優先
  if (!event.request.url.startsWith(self.location.origin)) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 自サイトのリソースはキャッシュ優先
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) {
          // バックグラウンドでキャッシュを更新
          fetch(event.request).then(response => {
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, response));
          }).catch(() => {});
          return cached;
        }
        return fetch(event.request);
      })
  );
});
