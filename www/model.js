/**
 * 任务系统的纯逻辑（不碰 DOM、不碰存储）——
 * 这样可以直接用 node 跑测试，也方便以后挪到原生侧复用。
 */

export const DEFAULT_THRESHOLDS = { green: 48, yellow: 12, orange: 4, red: 1 }

/** 本地时区的 YYYY-MM-DD，不能用 toISOString（那是 UTC，会跨天）。 */
export function dateKey(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function weekdayOf(key) {
  return parseDateKey(key).getDay() // 0=周日
}

export function daysBetween(fromKey, toKey) {
  const a = parseDateKey(fromKey)
  const b = parseDateKey(toKey)
  return Math.round((b - a) / 86400000)
}

/** 这条任务在指定日期是否“出现”。常挂任务靠它每天投影，而不是生成副本。 */
export function matchesDate(repeat, key) {
  if (!repeat) return false
  if (repeat.kind === 'once') return repeat.date === key
  if (repeat.kind === 'daily') return true
  if (repeat.kind === 'weekly') return (repeat.days || []).includes(weekdayOf(key))
  if (repeat.kind === 'everyN') {
    const n = Math.max(1, Number(repeat.n) || 1)
    const diff = daysBetween(repeat.anchor || key, key)
    return diff >= 0 && diff % n === 0
  }
  return false
}

/** 把毫秒格式化成“剩 2小时15分”，负数表示已超时。 */
export function formatRemaining(ms) {
  const overdue = ms < 0
  const abs = Math.abs(ms)
  const minutes = Math.floor(abs / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  let text
  if (days > 0) text = `${days}天${hours % 24}小时`
  else if (hours > 0) text = `${hours}小时${minutes % 60}分`
  else text = `${minutes}分钟`

  return overdue ? `已超时 ${text}` : `剩 ${text}`
}

/**
 * 倒计时分级。level 会直接映射成颜色：
 * calm(灰蓝) → green → yellow → orange → red
 */
export function countdown(deadlineIso, now = new Date(), thresholds = DEFAULT_THRESHOLDS) {
  if (!deadlineIso) return null
  const ms = new Date(deadlineIso).getTime() - now.getTime()
  if (Number.isNaN(ms)) return null
  const hours = ms / 3600000

  let level = 'calm'
  if (hours <= thresholds.red) level = 'red'
  else if (hours <= thresholds.orange) level = 'orange'
  else if (hours <= thresholds.yellow) level = 'yellow'
  else if (hours <= thresholds.green) level = 'green'

  return { level, ms, hours, label: formatRemaining(ms), overdue: ms < 0 }
}

/** 紧急 → 主线 → 支线 → 健身，同级按截止时间升序（无截止的排后面）。 */
const TYPE_ORDER = { urgent: 0, main: 1, side: 2, fitness: 3 }

export function projectDay(tasks, occurrenceDone, key) {
  const groups = { urgent: [], main: [], side: [], fitness: [] }

  for (const task of tasks) {
    if (task.archivedAt) continue
    if (!matchesDate(task.repeat, key)) continue
    const occKey = `${task.id}@${key}`
    groups[task.type]?.push({
      task,
      occKey,
      done: Boolean(occurrenceDone?.[occKey]),
    })
  }

  const sortByDeadline = (a, b) => {
    const da = a.task.deadline ? new Date(a.task.deadline).getTime() : Infinity
    const db = b.task.deadline ? new Date(b.task.deadline).getTime() : Infinity
    if (da !== db) return da - db
    return String(a.task.title).localeCompare(String(b.task.title), 'zh')
  }

  for (const type of Object.keys(groups)) groups[type].sort(sortByDeadline)
  return groups
}

/** 健身是“整块提醒”，界面上合成一个卡片。 */
export function fitnessSummary(groups) {
  const items = groups.fitness || []
  return { total: items.length, done: items.filter((item) => item.done).length, items }
}

export function sortTypes() {
  return Object.keys(TYPE_ORDER).sort((a, b) => TYPE_ORDER[a] - TYPE_ORDER[b])
}
