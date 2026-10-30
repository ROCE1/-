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
 * 只有加速前缀（gh-proxy）能通；而别的网络可能正好相反。
 * 所以按“前缀优先 → 直连兜底”的顺序逐个试，谁先成功用谁。
 */
function candidateUrls({ owner, repo, mirror }) {
  const raw = `https://raw.githubusercontent.com/${owner}/${repo}/main/latest.yml`
  const release = `https://github.com/${owner}/${repo}/releases/latest/download/latest.yml`
  const list = []
  if (mirror) {
    const prefix = mirror.endsWith('/') ? mirror : `${mirror}/`
    list.push(`${prefix}${raw}`, `${prefix}${release}`)
  }
  list.push(raw, release)
  return [...new Set(list)]
}

async function fetchText(url, timeoutMs) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

async function checkForUpdate(currentVersion) {
  const config = readConfig()
  const { owner, repo } = config
  if (!owner || !repo) {
    return { ok: false, reason: 'not-configured', message: '还没配置 GitHub 仓库（app.config.json）' }
  }

  const urls = candidateUrls({ owner, repo, mirror: config.mirror })
  const failures = []

  for (const url of urls) {
    try {
      const text = await fetchText(url, 8000)
      const matched = /^version:\s*(.+)$/m.exec(text)
      if (!matched) {
        failures.push(`${url} → 清单里没有 version`)
        continue
      }
      const latest = matched[1].trim()
      return {
        ok: true,
        current: currentVersion,
        latest,
        hasUpdate: compareVersions(latest, currentVersion) > 0,
        source: url,
        page: `https://github.com/${owner}/${repo}/releases`,
      }
    } catch (error) {
      failures.push(`${url} → ${error.message}`)
    }
  }

  return {
    ok: false,
    reason: 'unreachable',
    message: `所有更新地址都连不上（试了 ${urls.length} 个）`,
    detail: failures.join('\n'),
  }
}

module.exports = { checkForUpdate, compareVersions }
