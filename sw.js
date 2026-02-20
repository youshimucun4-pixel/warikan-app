// ふたりの割り勘帳 — Service Worker
const CACHE_NAME = 'warikan-v13';
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
  const req = event.request;
  const url = new URL(req.url);

  // 拡張機能や非GETリクエストとは競合しない
  if (req.method !== 'GET') return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Google Fonts 等の外部リソースはネットワーク優先
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(req)
        .then(response => {
          // 外部は無差別キャッシュせず、そのまま返す
          return response;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 自サイトのリソースはキャッシュ優先
  event.respondWith(
    caches.match(req)
      .then(cached => {
        if (cached) {
          // バックグラウンドでキャッシュを更新
          fetch(req).then(response => {
            if (response && response.ok) {
              caches.open(CACHE_NAME).then(cache => cache.put(req, response));
            }
          }).catch(() => {});
          return cached;
        }
        return fetch(req).then(response => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
          }
          return response;
        });
      })
  );
});
