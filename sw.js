const CACHE_NAME = 'rhea-dashboard-v26';
const ASSETS = [
  './',
  './index.html',
  './briefing.html',
  './css/styles.css',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // 同步接口（/api/、/.netlify/functions/）一律走网络、绝不缓存：
  // 否则「拉取同步」会一直返回首次缓存的旧云端快照，导致点同步看不到对方数据、
  // 只有硬刷（偶尔触发 SW 更新）才同步。这是此前多版修复都失效的根因。
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/functions/')) {
    if (event.request.method !== 'GET') return; // POST（同步上传）直接透传
    event.respondWith(
      fetch(event.request.clone(), { cache: 'no-store' }).catch(() =>
        new Response(JSON.stringify({ data: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, clone).catch(() => {});
        });
        return response;
      }).catch(() => cached);
    })
  );
});
