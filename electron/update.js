const fs = require('node:fs')
const path = require('node:path')

function readConfig() {
  const file = path.join(__dirname, '..', 'app.config.json')
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return { owner: '', repo: '' }
  }
}

/** a > b 返回正数；语义化版本的宽松比较，只比较前三段数字。 */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * 这台机器的网络对 github.com 与 raw.githubusercontent.com 都是阻断的，
 * 只有加速前缀（gh-proxy）能通；别的网络可能正好相反，所以前缀优先、直连兜底。
 *
 * 清单只认 Release 里的 latest.yml（由 CI 打包时生成，sha512 与安装包严格对应）。
 * 曾经试过把清单放仓库根目录，但那样得到的是“手写清单 + 另一份构建产物”，
 * sha512 一定对不上，所以放弃这条路。
 */
function baseUrls({ owner, repo, mirror }) {
  const release = `https://github.com/${owner}/${repo}/releases/latest/download`
  const list = []
  if (mirror) {
    const prefix = mirror.endsWith('/') ? mirror : `${mirror}/`
    list.push({ manifest: `${prefix}${release}/latest.yml`, download: `${prefix}${release}` })
  }
  list.push({ manifest: `${release}/latest.yml`, download: release })
  return list
}

async function fetchText(url, timeoutMs) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

/** 从 electron-builder 生成的 latest.yml 里取版本、安装包文件名、sha512、大小。 */
function parseManifest(text) {
  const version = /^version:\s*(.+)$/m.exec(text)?.[1]?.trim()
  if (!version) throw new Error('清单里没有 version')

  const fileBlock = /files:\s*\n((?:\s+-\s[\s\S]*?)(?=\n\S|$))/.exec(text)?.[1] ?? ''
  const url = /^\s+-\s*url:\s*(.+)$/m.exec(fileBlock)?.[1]?.trim() ?? null
  const sha512 = /^\s+sha512:\s*(.+)$/m.exec(fileBlock)?.[1]?.trim() ?? null
  const size = Number(/^\s+size:\s*(\d+)$/m.exec(fileBlock)?.[1] ?? 0)

  return { version, file: url, sha512, size }
}

async function checkForUpdate(currentVersion) {
  const config = readConfig()
  const { owner, repo } = config
  if (!owner || !repo) {
    return { ok: false, reason: 'not-configured', message: '还没配置 GitHub 仓库（app.config.json）' }
  }

  const bases = baseUrls({ owner, repo, mirror: config.mirror })
  const failures = []

  for (const base of bases) {
    try {
      const parsed = parseManifest(await fetchText(base.manifest, 8000))
      return {
        ok: true,
        current: currentVersion,
        latest: parsed.version,
        hasUpdate: compareVersions(parsed.version, currentVersion) > 0,
        file: parsed.file,
        sha512: parsed.sha512,
        size: parsed.size,
        downloadUrl: base.download && parsed.file ? `${base.download}/${encodeURIComponent(parsed.file)}` : null,
        manifestUrl: base.manifest,
        page: `https://github.com/${owner}/${repo}/releases`,
      }
    } catch (error) {
      failures.push(`${base.manifest} → ${error.message}`)
    }
  }

  return {
    ok: false,
    reason: 'unreachable',
    message: `所有更新地址都连不上（试了 ${bases.length} 个）`,
    detail: failures.join('\n'),
  }
}

/**
 * 流式下载安装包到临时目录。onProgress 收到 { received, total }。
 * 只负责下载，不校验、不执行——校验和安装由调用方决定。
 */
async function downloadInstaller(url, targetDir, fileName, onProgress) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`)

  const total = Number(response.headers.get('content-length') ?? 0)
  const target = path.join(targetDir, fileName)
  await fs.promises.mkdir(targetDir, { recursive: true })

  const handle = await fs.promises.open(target, 'w')
  try {
    let received = 0
    for await (const chunk of response.body) {
      await handle.write(chunk)
      received += chunk.length
      if (onProgress) onProgress({ received, total })
    }
  } finally {
    await handle.close()
  }

  return target
}

module.exports = { checkForUpdate, downloadInstaller, compareVersions, parseManifest }
