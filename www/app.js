/* 三种运行环境共用这一份脚本：
 * 1) Electron 桌面端：window.bridge 由 preload 注入，检查/下载/安装走主进程。
 * 2) Capacitor 安卓端：window.Capacitor 存在，更新检查留待原生实现（见 AGENTS.md）。
 * 3) 纯浏览器 / PWA：两者都没有，只做展示。
 */
const $ = (id) => document.getElementById(id)

const state = {
  env: 'web',
  version: '0.0.0',
  update: null,
  downloadedPath: null,
}

function setStatus(text, tone) {
  const el = $('update-status')
  el.textContent = text
  el.className = tone || ''
}

function setProgress(received, total) {
  const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0
  $('progress-wrap').hidden = false
  $('progress-fill').style.width = `${percent}%`
  const mb = (n) => (n / 1024 / 1024).toFixed(1)
  $('progress-text').textContent = total > 0 ? `${percent}% · ${mb(received)}/${mb(total)} MB` : `${mb(received)} MB`
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
  $('download').hidden = true
  $('open').hidden = true
  $('progress-wrap').hidden = true
  setStatus('正在检查…')

  try {
    if (state.env === 'desktop') {
      const result = await window.bridge.checkUpdate()
      if (!result.ok) {
        setStatus(result.message || '检查失败', 'warn')
        return
      }
      state.update = result
      if (result.hasUpdate) {
        setStatus(`有新版本 ${result.latest}（当前 ${result.current}）`, 'ok')
        $('download').hidden = false
        $('open').hidden = false
      } else {
        setStatus(`已是最新（${result.current}）`, 'ok')
      }
      return
    }

    setStatus('移动端更新检查待接入原生通道（见 AGENTS.md）', 'warn')
  } catch (error) {
    setStatus(`检查出错：${error.message}`, 'err')
  } finally {
    button.disabled = false
  }
}

async function downloadAndInstall() {
  const button = $('download')
  if (!state.update || !state.update.downloadUrl) {
    setStatus('清单里没有可用的下载地址', 'err')
    return
  }

  button.disabled = true
  $('check').disabled = true
  setStatus('正在下载…')

  try {
    const result = await window.bridge.downloadUpdate({
      url: state.update.downloadUrl,
      sha512: state.update.sha512,
      file: state.update.file,
    })
    if (!result || !result.ok) throw new Error('下载未完成')

    state.downloadedPath = result.path
    setStatus('下载完成，正在启动安装…', 'ok')
    await window.bridge.installUpdate(result.path)
  } catch (error) {
    setStatus(`下载失败：${error.message}`, 'err')
    button.disabled = false
    $('check').disabled = false
  }
}

function bind() {
  $('version').textContent = state.version
  $('check').addEventListener('click', checkUpdate)
  $('download').addEventListener('click', downloadAndInstall)
  $('open').addEventListener('click', () => {
    const page = (state.update && state.update.page) || 'https://github.com/ROCE1/-/releases'
    if (state.env === 'desktop') window.bridge.open(page)
    else window.open(page, '_blank', 'noopener')
  })

  if (state.env === 'desktop' && window.bridge.onProgress) {
    window.bridge.onProgress(({ received, total }) => setProgress(received, total))
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  if (!location.protocol.startsWith('http')) return
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
