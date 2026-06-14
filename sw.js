const CACHE_NAME = 'smartdiary-cache-v2'; // キャッシュを更新するためにバージョンをv2にアップ

// 完全にオフラインで動作させるために事前にキャッシュ（プレキャッシュ）するリソース
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './smartdiary192.png',
  './smartdiary512.jpg',
  // index.htmlで使用されている外部CDNリソース
  'https://cdn.tailwindcss.com?plugins=typography',
  'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
  'https://cdn.jsdelivr.net/npm/dompurify@3.0.6/dist/purify.min.js',
  'https://cdn.jsdelivr.net/npm/exif-js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&display=swap'
];

// インストールイベント：必要なリソースをまとめてキャッシュに保存
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Pre-caching offline assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting()) // 新しいサービスワーカーをすぐに有効化
  );
});

// アクティベートイベント：古いキャッシュの削除
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
    }).then(() => self.clients.claim()) // アクティブ化後すぐに制御を開始
  );
});

// フェッチイベント：ネットワークリクエスト発生時の処理
// (Stale-While-Revalidate 戦略：キャッシュから即座に返しつつ、裏で最新版に更新)
self.addEventListener('fetch', (event) => {
  // ブラウザ拡張機能などの http/https 以外のプロトコル（chrome-extension等）は除外
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // 1. キャッシュがあれば即座にそれを返す
        // 2. 同時に裏でネットワークから最新データを取得し、キャッシュを静かに更新する
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {
          // オフライン時はネットワークエラーになりますが、すでにキャッシュを返しているので無視してOK
        });

        return cachedResponse;
      }

      // キャッシュにないリクエスト（FontAwesomeのフォントファイルwoff2など、動的に読み込まれるもの）
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'error') {
          return networkResponse;
        }

        // 取得した新しいリソースを複製してキャッシュに保存
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      });
    })
  );
});