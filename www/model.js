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

/** 任务类型在界面/通知里的固定顺序：紧急 → 支线 → 日常 → 主线。 */
export const TYPE_ORDER = ['urgent', 'side', 'daily', 'main']
export const TYPE_LABELS = { urgent: '紧急', side: '支线', daily: '日常', main: '主线' }
/** 只出现在常驻通知里的类型（主线不上横幅）。 */
export const NOTIFY_TYPES = ['urgent', 'side', 'daily']

const DAY_MS = 86400000

/** 常挂任务：每天重复的（主线和日常默认就是这种）。 */
export function isAlwaysOn(task) {
  return task?.repeat?.kind === 'daily'
}

/**
 * 倒计时不足 24 小时的临时任务自动抬进「紧急」区。
 * 常挂任务（每天重复）不参与提升，否则每天都会把列表顶满。
 */
export function escalatesToUrgent(task, nowMs = Date.now()) {
  if (!task?.deadline) return false
  if (isAlwaysOn(task)) return false
  const due = new Date(task.deadline).getTime()
  if (!Number.isFinite(due)) return false
  return due - nowMs < DAY_MS
}

/**
 * 一次性任务在某天是否出现。
 *
 * 这是 0.8.x 的一个坑：以前只看 `repeat.date`，于是“11/4 建的、11/8 截止”的任务
 * 到了 11/5 零点就从列表里消失了。现在：
 * - 没有截止：只在设定的那一天
 * - 有截止：从设定那天起一直显示到截止日；截止日之后只在“今天”露面（提醒你还没做）
 */
export function occursOn(task, key, nowMs = Date.now()) {
  const repeat = task?.repeat
  if (!repeat) return false
  if (repeat.kind !== 'once') return matchesDate(repeat, key)

  if (key < repeat.date) return false
  if (!task.deadline) return key === repeat.date

  const due = new Date(task.deadline).getTime()
  if (!Number.isFinite(due)) return key === repeat.date

  const dueKey = dateKey(new Date(due))
  if (key <= dueKey) return true
  return key === dateKey(new Date(nowMs))
}

/**
 * 把任务投影到某一天：紧急 / 支线 / 日常 / 主线 四组，同级按截止时间升序（无截止的排后面）。
 * 健身已经拆成独立数据（见 fitness.js），这里保留 fitness 分组只是为了兼容迁移前的旧数据。
 *
 * nowMs 只在“今天”用来判断 24 小时内自动升级；看历史日期时保持原始类型。
 * doneTaskIds：任一日期完成过的任务 id 集合 —— 一次性任务做完就不该再出现。
 */
export function projectDay(tasks, occurrenceDone, key, nowMs = Date.now(), doneTaskIds) {
  const groups = { urgent: [], side: [], daily: [], main: [], fitness: [] }
  const isToday = key === dateKey(new Date(nowMs))

  for (const task of tasks) {
    if (task.archivedAt) continue

    const occKey = `${task.id}@${key}`
    const doneToday = Boolean(occurrenceDone?.[occKey])
    // 一次性任务只要有任意一天完成过，就不再出现（除了完成当天留个 ✓）
    if (task.repeat?.kind === 'once' && doneTaskIds?.has(task.id) && !doneToday) continue

    if (!occursOn(task, key, nowMs)) continue

    let type = task.type
    if (isToday && type !== 'urgent' && escalatesToUrgent(task, nowMs)) type = 'urgent'

    groups[type]?.push({
      task,
      occKey,
      done: doneToday,
      escalated: type !== task.type,
    })
  }

  const sortByDeadline = (a, b) => {
    // 手动排序优先：只要两边都排过序就按 order；只排过一边的排在前面
    const oa = Number.isFinite(a.task.order) ? a.task.order : null
    const ob = Number.isFinite(b.task.order) ? b.task.order : null
    if (oa !== null && ob !== null && oa !== ob) return oa - ob
    if (oa !== null && ob === null) return -1
    if (oa === null && ob !== null) return 1

    const da = a.task.deadline ? new Date(a.task.deadline).getTime() : Infinity
    const db = b.task.deadline ? new Date(b.task.deadline).getTime() : Infinity
    if (da !== db) return da - db
    return String(a.task.title).localeCompare(String(b.task.title), 'zh')
  }

  for (const type of Object.keys(groups)) groups[type].sort(sortByDeadline)
  return groups
}

/**
 * 常驻通知只显示一行：在「紧急/支线/日常」里挑截止时间最近、且还没完成的那一条。
 * 主线永远不上横幅。
 */
export function nearestDeadline(groups) {
  let best = null
  for (const type of NOTIFY_TYPES) {
    for (const entry of groups[type] || []) {
      if (entry.done || !entry.task.deadline) continue
      const due = new Date(entry.task.deadline).getTime()
      if (!Number.isFinite(due)) continue
      if (!best || due < best.due) best = { type, entry, due }
    }
  }
  return best
}

/**
 * 今日清单（与软件内顺序一致：紧急→支线→日常→主线），给桌面小组件用。
 * 完成的任务也列出来，末尾带 ✓。
 */
export function dayLines(groups, { limit = 12, suffix } = {}) {
  const lines = []
  for (const type of TYPE_ORDER) {
    for (const entry of groups[type] || []) {
      const extra = typeof suffix === 'function' ? suffix(entry, type) || '' : ''
      lines.push(`${TYPE_LABELS[type]} ${entry.task.title}${extra}${entry.done ? ' ✓' : ''}`)
      if (lines.length >= limit) return lines
    }
  }
  return lines
}

/** 某天到底有没有任务（日历打点用）。 */
export function hasAnyTask(tasks, occurrenceDone, key, nowMs = Date.now(), doneTaskIds) {
  const groups = projectDay(tasks, occurrenceDone, key, nowMs, doneTaskIds)
  return Object.keys(groups).some((type) => groups[type].length > 0)
}

/**
 * 手动排序：在“当前可见顺序”的 id 列表里把某一项上移/下移一格。
 * delta = -1 上移、+1 下移；越界或找不到就原样返回。
 */
export function moveInList(ids, id, delta) {
  const from = ids.indexOf(id)
  if (from < 0) return ids.slice()
  const to = from + delta
  if (to < 0 || to >= ids.length) return ids.slice()
  const next = ids.slice()
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}

/**
 * 截止提醒提前量（分钟）：任务自己的设置优先，其次全局默认，最后兜底 15 分钟。
 * 0 / 负数 / 非数字都视为“没设置”。
 */
export function leadMinutesFor(task, settings) {
  const own = Number(task?.leadMinutes)
  if (Number.isFinite(own) && own > 0) return own
  const global = Number(settings?.leadMinutes)
  if (Number.isFinite(global) && global > 0) return global
  return 15
}
