const CACHE_NAME = 'smartdiary-cache-v1';
const urlsToCache = [
  './',
  './manifest.json',
  // TailwindやFontAwesomeなどローカルに置いている場合はここに追加します
  // './lib/tailwind.min.js',
  // './lib/marked.min.js',
  // './lib/purify.min.js',
  // './lib/exif.js',
  // './lib/all.min.css',
  // './lib/font.css'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  // ローカルファイルアクセス（file://）など対応できないスキームは除外
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});
