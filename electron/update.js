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
 * 走 `releases/latest/download/` 这条不需要 GitHub API 的路径：
 * 实测 api.github.com 在本机时通时不通，而 github.com 稳定。
 */
async function checkForUpdate(currentVersion) {
  const { owner, repo } = readConfig()
  if (!owner || !repo) {
    return { ok: false, reason: 'not-configured', message: '还没配置 GitHub 仓库（app.config.json）' }
  }

  const base = `https://github.com/${owner}/${repo}/releases/latest/download`
  let response
  try {
    response = await fetch(`${base}/latest.yml`, { redirect: 'follow' })
  } catch (error) {
    return { ok: false, reason: 'network', message: `网络错误：${error.message}` }
  }
  if (!response.ok) {
    return { ok: false, reason: `http-${response.status}`, message: `更新清单拉取失败（HTTP ${response.status}）` }
  }

  const text = await response.text()
  const matched = /^version:\s*(.+)$/m.exec(text)
  if (!matched) {
    return { ok: false, reason: 'bad-manifest', message: 'latest.yml 里没有 version 字段' }
  }

  const latest = matched[1].trim()
  return {
    ok: true,
    current: currentVersion,
    latest,
    hasUpdate: compareVersions(latest, currentVersion) > 0,
    page: `https://github.com/${owner}/${repo}/releases/latest`,
  }
}

module.exports = { checkForUpdate, compareVersions }
