const CACHE_NAME = 'smartdiary-cache-v3';

// プレキャッシュするリソース（すべて相対パス・外部CDN）
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './smartdiary192.png',
  './smartdiary512.jpg',
  'https://cdn.tailwindcss.com?plugins=typography',
  'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
  'https://cdn.jsdelivr.net/npm/dompurify@3.0.6/dist/purify.min.js',
  'https://cdn.jsdelivr.net/npm/exif-js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// インストールイベント
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Pre-caching assets');
        // 1つずつキャッシュして、失敗したURLがあってもスキップできるように個別に登録
        return Promise.allSettled(
          ASSETS_TO_CACHE.map(url => 
            cache.add(url).catch(err => console.error(`Failed to cache: ${url}`, err))
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// アクティベートイベント（古いキャッシュの削除）
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// フェッチイベント（ネットワークリクエストの制御）
self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith('http')) return;

  // ナビゲーションリクエスト（＝ユーザーがアプリを起動した時やページを読み込んだ時）の最適化
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((perfectHit) => {
        // ナビゲーション時は、最悪でも必ずキャッシュされた index.html を返す
        return perfectHit || fetch(event.request).catch(() => caches.match('./'));
      })
    );
    return;
  }

  // 通常のリソース（画像やスクリプト）のリクエスト処理
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        // キャッシュがあれば即座に返し、裏で最新版をネットワーク取得して更新（Stale-While-Revalidate）
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => { /* オフライン時は何もしない */ });

        return cachedResponse;
      }

      // キャッシュになければネットワークから取得
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }
        // 動的に取得できたリソースはキャッシュに追加
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch((err) => {
        // Google Fontsなどの特殊なリクエストでオフライン時のフォールバック
        if (event.request.url.includes('fonts.googleapis.com') || event.request.url.includes('fonts.gstatic.com')) {
          return caches.match(event.request, { ignoreSearch: true });
        }
        throw err;
      });
    })
  );
});
