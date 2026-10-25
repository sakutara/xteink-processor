// Service worker: precache toàn bộ asset, cache-first, có version.
// Đổi VERSION mỗi khi sửa bất kỳ file nào trong danh sách.
const VERSION = 'v14';
const CACHE = `xteink-epub-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'manifest.webmanifest',
  'src/convert.js',
  'src/normalize.js',
  'src/cover.js',
  'src/writer.js',
  'src/util.js',
  'src/wordwise.js',
  'data/wordwise-en.tsv',
  'data/wordwise-vi.tsv',
  'src/image.js',
  'src/editor.js',
  'src/readers/epub.js',
  'src/readers/mobi.js',
  'src/readers/fb2.js',
  'src/readers/html.js',
  'src/readers/txt.js',
  'src/readers/pdf.js',
  'vendor/jszip.min.js',
  'vendor/foliate-mobi.js',
  'vendor/pdf.min.js',
  'vendor/pdf.worker.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('xteink-epub-') && k !== CACHE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (e) {
      if (req.mode === 'navigate') {
        const fallback = await cache.match('index.html');
        if (fallback) return fallback;
      }
      throw e;
    }
  })());
});
