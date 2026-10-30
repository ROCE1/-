/* 三种运行环境共用这一份脚本：
 * 1) Electron 桌面端：window.bridge 由 preload 注入，更新检查走主进程。
 * 2) Capacitor 安卓端：window.Capacitor 存在，更新检查留待原生实现（见 AGENTS.md）。
 * 3) 纯浏览器 / PWA：两者都没有，只做展示。
 */
const $ = (id) => document.getElementById(id)

const state = {
  env: 'web',
  version: '0.0.0',
  updateUrl: '',
}

function setStatus(text, tone) {
  const el = $('update-status')
  el.textContent = text
  el.className = tone || ''
}

async function detectEnvironment() {
  if (window.bridge && typeof window.bridge.info === 'function') {
    const info = await window.bridge.info()
    state.env = 'desktop'
    state.version = info.version
    $('mode').textContent = `桌面端（Electron ${info.platform}）· ${info.packaged ? '已打包' : '开发模式'}`
    return
  }

  if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) {
    state.env = 'android'
    state.version = '0.1.0'
    $('mode').textContent = '安卓端（Capacitor）'
    return
  }

  state.env = 'web'
  state.version = '0.1.0'
  $('mode').textContent = '网页端（PWA，可直接加到主屏幕）'
}

async function checkUpdate() {
  const button = $('check')
  button.disabled = true
  setStatus('正在检查…')

  try {
    if (state.env === 'desktop') {
      const result = await window.bridge.checkUpdate()
      if (!result.ok) {
        setStatus(result.message || '检查失败', 'warn')
        return
      }
      if (result.hasUpdate) {
        setStatus(`有新版本 ${result.latest}（当前 ${result.current}）`, 'ok')
        state.updateUrl = result.page
        $('open').hidden = false
      } else {
        setStatus(`已是最新（${result.current}）`, 'ok')
      }
      return
    }

    // 网页 / 安卓：浏览器侧读不到 GitHub 的 CORS 头，这里只做提示。
    setStatus('移动端更新检查待接入原生通道（见 AGENTS.md）', 'warn')
  } catch (error) {
    setStatus(`检查出错：${error.message}`, 'err')
  } finally {
    button.disabled = false
  }
}

function bind() {
  $('version').textContent = state.version
  $('check').addEventListener('click', checkUpdate)
  $('open').addEventListener('click', () => {
    if (!state.updateUrl) return
    if (state.env === 'desktop') window.bridge.open(state.updateUrl)
    else window.open(state.updateUrl, '_blank', 'noopener')
  })
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  if (!location.protocol.startsWith('http')) return // Electron 走 file://，不需要也不允许
  try {
    await navigator.serviceWorker.register('./sw.js')
  } catch {
    /* PWA 缓存失败不影响主体功能 */
  }
}

detectEnvironment()
  .catch(() => {})
  .finally(() => {
    bind()
    registerServiceWorker()
  })
