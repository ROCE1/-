// 这个文件是「自我销毁」的 Service Worker。
//
// 0.1.x 时期注册过一个 PWA service worker，它把 index.html / style.css / app.js 缓存了下来。
// 升级到 0.2.x 后，旧 SW 仍把旧资源喂给新页面，导致「新界面 + 旧脚本」→ 按钮全部失灵。
//
// 原生 App 不再需要 SW（资源都在本地 APK 里），所以这里只做清理：
// 清掉所有缓存、注销自己，然后刷新已打开的页面。
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys()
        await Promise.all(keys.map((key) => caches.delete(key)))
      } catch (error) {
        /* 清缓存失败不影响主流程 */
      }
      try {
        await self.registration.unregister()
      } catch (error) {
        /* 同上 */
      }
      const clients = await self.clients.matchAll({ type: 'window' })
      clients.forEach((client) => client.navigate(client.url))
    })(),
  )
})
