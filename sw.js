/* Wiesbaden Survivors — offline-first service worker
 * 策略：
 *  - install: 预缓存 app shell（index.html 为单文件游戏，字体已内嵌）
 *  - fetch:   同源 GET → cache-first，命中即返回；未命中则网络回退并写入缓存
 *  - 跨域/非 GET（如 MQTT over WebSocket 不走 fetch）→ 直接放行
 *  - activate: 清理旧版本缓存
 */
/* CACHE-Name wird beim Build aus dem Content-Hash von index.html gestempelt
   (tools/build.js). Aendert sich das Spiel, aendert sich der Name -> die
   activate-Phase raeumt den alten Cache weg. Manuelles Hochzaehlen entfaellt. */
const CACHE = 'wbns-527216329053';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './maskable-512.png'];

self.addEventListener('install', (event) => {
  /* KEIN automatisches skipWaiting: der neue Worker wartet, bis der Spieler im
     Update-Toast "Neu laden" klickt (siehe message-Handler). So springt der
     Cache nicht mitten in der Sitzung um. */
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL))
  );
});

/* Auf Zuruf der Seite aktivieren (Update-Toast). */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // WebSocket/POST 等直接放行
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 跨域（字体 CDN 等）不拦截

  event.respondWith(
    caches.match(req, { ignoreSearch: false }).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          // 导航请求离线兜底到 app shell
          if (req.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
    })
  );
});
