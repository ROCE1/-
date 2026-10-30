/* 三种运行环境共用这一份脚本：
 * 1) Electron 桌面端：window.bridge 由 preload 注入，检查/下载/安装走主进程。
 * 2) Capacitor 安卓端：用 CapacitorHttp 拉清单（原生请求，绕开 CORS），下载交给系统浏览器。
 * 3) 纯浏览器 / PWA：两者都没有，只做展示。
 */
const $ = (id) => document.getElementById(id)

// 安卓/网页端没有主进程可读 app.config.json，这里保留同一份仓库坐标。
// 改仓库时记得同时改 app.config.json 与这里（AGENTS.md 有备注）。
const SOURCE = {
  owner: 'ROCE1',
  repo: '-',
  mirror: 'https://gh-proxy.com/',
}

const state = {
  env: 'web',
  version: '0.0.0',
  update: null,
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

function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

async function readBundledVersion() {
  try {
    const res = await fetch('./app-version.json', { cache: 'no-store' })
    if (res.ok) return (await res.json()).version || '0.0.0'
  } catch {
    /* 没打包版本文件时退回默认值 */
  }
  return '0.0.0'
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
    state.version = await readBundledVersion()
    $('mode').textContent = '安卓端（Capacitor）'
    return
  }

  state.env = 'web'
  state.version = await readBundledVersion()
  $('mode').textContent = '网页端（PWA，可直接加到主屏幕）'
}

/** 安卓端用 CapacitorHttp 发请求：走原生栈，不受 CORS 限制。 */
async function nativeGetText(url) {
  const http = window.Capacitor?.Plugins?.CapacitorHttp
  if (http && typeof http.get === 'function') {
    const res = await http.get({ url, responseType: 'text' })
    if (res.status && res.status >= 400) throw new Error(`HTTP ${res.status}`)
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
  }
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function checkMobileUpdate() {
  const release = `https://github.com/${SOURCE.owner}/${SOURCE.repo}/releases/latest/download`
  const candidates = [
    `${SOURCE.mirror}${release}/latest.yml`,
    `${release}/latest.yml`,
  ]
  const failures = []
  for (const url of candidates) {
    try {
      const text = await nativeGetText(url)
      const latest = /^version:\s*(.+)$/m.exec(text)?.[1]?.trim()
      if (!latest) throw new Error('清单里没有 version')
      const apkUrl = `${SOURCE.mirror}https://github.com/${SOURCE.owner}/${SOURCE.repo}/releases/latest/download/DSH-App-${latest}-release.apk`
      return {
        ok: true,
        current: state.version,
        latest,
        hasUpdate: compareVersions(latest, state.version) > 0,
        apkUrl,
        page: `https://github.com/${SOURCE.owner}/${SOURCE.repo}/releases`,
        sourceHost: new URL(url).host,
      }
    } catch (error) {
      failures.push(`${url} → ${error.message}`)
    }
  }
  return { ok: false, reason: 'unreachable', message: `所有更新地址都连不上（试了 ${candidates.length} 个）`, detail: failures.join('\n') }
}

async function checkUpdate() {
  const button = $('check')
  button.disabled = true
  $('download').hidden = true
  $('open').hidden = true
  $('progress-wrap').hidden = true
  setStatus('正在检查…')

  try {
    const result = state.env === 'desktop'
      ? await window.bridge.checkUpdate()
      : await checkMobileUpdate()

    if (!result.ok) {
      setStatus(result.message || '检查失败', 'warn')
      return
    }

    state.update = result
    const source = result.sourceHost || (result.manifestUrl ? new URL(result.manifestUrl).host : '')
    const suffix = source ? ` · 来源 ${source}` : ''

    if (result.hasUpdate) {
      setStatus(`有新版本 ${result.latest}（当前 ${result.current}）${suffix}`, 'ok')
      $('download').hidden = false
      $('open').hidden = false
      $('download').textContent = state.env === 'desktop' ? '下载并安装' : '下载并安装（浏览器）'
    } else {
      setStatus(`已是最新（${result.current}）${suffix}`, 'ok')
    }
  } catch (error) {
    setStatus(`检查出错：${error.message}`, 'err')
  } finally {
    button.disabled = false
  }
}

async function downloadAndInstall() {
  const button = $('download')
  if (!state.update) {
    setStatus('还没有可用的更新信息', 'err')
    return
  }

  // 桌面端：主进程下载、校验、静默安装
  if (state.env === 'desktop') {
    if (!state.update.downloadUrl) {
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
      setStatus('下载完成，正在启动安装…', 'ok')
      await window.bridge.installUpdate(result.path)
    } catch (error) {
      setStatus(`下载失败：${error.message}`, 'err')
      button.disabled = false
      $('check').disabled = false
    }
    return
  }

  // 安卓端：把 APK 交给系统浏览器下载并安装（Android 不允许应用静默安装）
  if (state.env === 'android') {
    setStatus('已交给浏览器下载，下载完点安装即可', 'ok')
    window.open(state.update.apkUrl, '_blank')
    return
  }

  setStatus('网页端请到发布页手动下载', 'warn')
  window.open(state.update.page, '_blank')
}

function bind() {
  $('version').textContent = state.version
  $('check').addEventListener('click', checkUpdate)
  $('download').addEventListener('click', downloadAndInstall)
  $('open').addEventListener('click', () => {
    const page = (state.update && state.update.page) || `https://github.com/${SOURCE.owner}/${SOURCE.repo}/releases`
    if (state.env === 'desktop') window.bridge.open(page)
    else window.open(page, '_blank')
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
