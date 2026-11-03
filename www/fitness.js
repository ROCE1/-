/**
 * 健身模块的纯逻辑（不碰 DOM、不碰存储）——和 model.js 一样可以直接用 node 测试。
 *
 * 轮换规则（B 方案）：以基准日 anchor 计算，天数差为偶数 → 力量日，奇数 → 有氧日。
 * 用户可以在当天手动切到另一天，只影响当天显示（override 存日期，跨天自动失效）。
 */
import { daysBetween, matchesDate } from './model.js'

export const DAY_LABEL = { strength: '力量日', cardio: '有氧日' }
export const DAY_TYPES = ['strength', 'cardio']

/** 今天“本应”是哪一天：只看基准日，不看手动切换。 */
export function rotationFor(anchorKey, dayKey) {
  if (!anchorKey) return 'strength'
  const diff = daysBetween(anchorKey, dayKey)
  if (Number.isNaN(diff)) return 'strength'
  return Math.abs(diff) % 2 === 0 ? 'strength' : 'cardio'
}

/** 今天“实际”显示哪一天：手动切换优先，且只在切换当天有效。 */
export function dayKind(settings, dayKey) {
  const override = settings?.fitnessOverride
  if (override?.date === dayKey && DAY_TYPES.includes(override.day)) return override.day
  return rotationFor(settings?.fitnessAnchor, dayKey)
}

/** 每条健身项的副标题：`4 组 × 8 个` / `30 分钟 / 5 km`。 */
export function detailOf(item) {
  if (item.day === 'cardio') {
    const parts = []
    if (item.minutes) parts.push(`${item.minutes} 分钟`)
    if (item.km) parts.push(`${item.km} km`)
    return parts.join(' / ')
  }
  const parts = []
  if (item.sets) parts.push(`${item.sets} 组`)
  if (item.reps) parts.push(`× ${item.reps} 个`)
  return parts.join(' ')
}

/** 某天、某一类（力量/有氧）应该显示的健身项，按创建时间稳定排序。 */
export function itemsForDay(items, kind, dayKey) {
  return items
    .filter((item) => item && !item.archivedAt)
    .filter((item) => item.day === kind)
    .filter((item) => matchesDate(item.repeat, dayKey))
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
}

/** 通知栏用的一行摘要。 */
export function fitnessLine(items, kind, dayKey, doneMap) {
  const list = itemsForDay(items, kind, dayKey)
  if (!list.length) return null
  const done = list.filter((item) => Boolean(doneMap?.[`${item.id}@${dayKey}`])).length
  const label = DAY_LABEL[kind]
  return `健身 ${label} ${done}/${list.length}`
}
