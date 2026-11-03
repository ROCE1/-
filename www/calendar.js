/**
 * 月历的纯逻辑（不碰 DOM）：把年月摊成周表，方便界面直接画。
 * 周一为每周第一天（中文习惯），行数按当月实际需要（4–6 行）。
 */
import { dateKey } from './model.js'

export function monthTitle(year, month) {
  return `${year} 年 ${month} 月`
}

/** 翻月：delta 为 +1 / -1，跨年自动进位。 */
export function shiftMonth({ year, month }, delta) {
  const date = new Date(year, month - 1 + delta, 1)
  return { year: date.getFullYear(), month: date.getMonth() + 1 }
}

/** 当月所有日期的 key（用于统计“哪天有任务”）。 */
export function monthDays(year, month) {
  const count = new Date(year, month, 0).getDate()
  const keys = []
  for (let day = 1; day <= count; day += 1) keys.push(dateKey(new Date(year, month - 1, day)))
  return keys
}

/**
 * 月历网格：返回若干周，每周 7 个格子。
 * 每个格子：{ key, day, inMonth, today }
 */
export function monthMatrix(year, month, todayKey = dateKey()) {
  const first = new Date(year, month - 1, 1)
  const offset = (first.getDay() + 6) % 7 // 周一=0
  const start = new Date(year, month - 1, 1 - offset)
  const daysInMonth = new Date(year, month, 0).getDate()
  const weekCount = Math.ceil((offset + daysInMonth) / 7)

  const weeks = []
  for (let w = 0; w < weekCount; w += 1) {
    const week = []
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d)
      const key = dateKey(date)
      week.push({
        key,
        day: date.getDate(),
        inMonth: date.getMonth() === month - 1,
        today: key === todayKey,
      })
    }
    weeks.push(week)
  }
  return weeks
}
