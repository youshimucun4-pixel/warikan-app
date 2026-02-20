// ふたりの割り勘帳 — Service Worker
const CACHE_NAME = 'warikan-v15';
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

  // 拡張機能や非GET/非http(s)は対象外
  if (req.method !== 'GET') return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // HTML(document/navigate)は常にブラウザ標準のネットワーク処理に任せる
  // （一瞬表示→消えるような stale HTML 問題を避ける）
  if (req.mode === 'navigate' || req.destination === 'document') return;

  // 外部リソースは触らない
  if (url.origin !== self.location.origin) return;

  // 同一オリジンの静的アセットのみをキャッシュ対象にする
  const staticAsset = /\.(?:css|js|json|svg|png|jpg|jpeg|webp|woff2?)$/i.test(url.pathname);
  if (!staticAsset) return;

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
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
