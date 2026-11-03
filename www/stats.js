/**
 * 统计（环形图）的纯逻辑 —— 不碰 DOM、不碰存储，可以直接用 node 测试。
 *
 * 数据只有一个来源：sessions 里 kind === 'busy' 的区间（点「繁忙」写入 start，关掉写入 end）。
 * 所以「工作占比」= 忙碌时长 ÷ 已经过去的时间；没有忙碌记录的时段一律算空闲。
 * 未结束的会话（App 被杀、人忘了关）按“到当前时刻”算，避免少记。
 */

const MINUTE = 60000

function toMs(value) {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

/** 把会话摊平成 [start, end] 区间：丢掉倒挂/坏数据，未结束的用 now 收尾，重叠的合并。 */
export function busyIntervals(sessions, nowMs = Date.now()) {
  const raw = []
  for (const session of sessions || []) {
    if (!session || session.kind !== 'busy') continue
    const start = toMs(session.start)
    if (start === null) continue
    const end = session.end ? toMs(session.end) : nowMs
    if (end === null || end <= start) continue
    raw.push([start, Math.min(end, nowMs)])
  }
  raw.sort((a, b) => a[0] - b[0])

  const merged = []
  for (const [start, end] of raw) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

/** 区间落在 [from, to] 内的有效毫秒数。 */
export function overlapMs(intervals, fromMs, toMs) {
  let total = 0
  for (const [start, end] of intervals) {
    const overlap = Math.min(end, toMs) - Math.max(start, fromMs)
    if (overlap > 0) total += overlap
  }
  return total
}

export function startOfDay(now = new Date()) {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** 周一 0 点（中文习惯的一周起点）。 */
export function startOfWeek(now = new Date()) {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  const offset = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - offset)
  return date.getTime()
}

function bucket(intervals, fromMs, nowMs) {
  const elapsedMs = Math.max(0, nowMs - fromMs)
  const busyMs = Math.min(overlapMs(intervals, fromMs, nowMs), elapsedMs)
  return {
    busyMs,
    idleMs: Math.max(0, elapsedMs - busyMs),
    elapsedMs,
    percent: elapsedMs > 0 ? busyMs / elapsedMs : 0,
  }
}

/** 今日 / 本周两份占比。 */
export function summarize(sessions, now = new Date()) {
  const nowMs = now.getTime()
  const intervals = busyIntervals(sessions, nowMs)
  return {
    today: bucket(intervals, startOfDay(now), nowMs),
    week: bucket(intervals, startOfWeek(now), nowMs),
  }
}

/** 环形图的百分比文案，最多一位小数。 */
export function percentLabel(ratio) {
  const value = Number.isFinite(ratio) ? ratio * 100 : 0
  if (value <= 0) return '0%'
  if (value >= 99.95) return '100%'
  return `${value.toFixed(1).replace(/\.0$/, '')}%`
}

/** 时长文案：`3 小时 20 分` / `2 小时` / `25 分钟`。 */
export function formatDuration(ms) {
  const minutes = Math.max(0, Math.round((ms || 0) / MINUTE))
  if (minutes < 1) return '0 分钟'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 1) return `${minutes} 分钟`
  if (rest === 0) return `${hours} 小时`
  return `${hours} 小时 ${rest} 分`
}
