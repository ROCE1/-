/* 最小可用的离线壳：只缓存页面骨架。
 * 真正的资源缓存策略等功能定了再细化，避免现在就把版本号写死。
 */
const CACHE = 'dsh-app-v1'
const SHELL = ['./index.html', './style.css', './app.js', './manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request).catch(() => caches.match('./index.html'))),
  )
})
