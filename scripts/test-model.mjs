// 纯逻辑的回归测试：node scripts/test-model.mjs
import {
  dateKey,
  daysBetween,
  weekdayOf,
  matchesDate,
  formatRemaining,
  countdown,
  projectDay,
  hasAnyTask,
  DEFAULT_THRESHOLDS,
} from '../www/model.js'
import { dayKind, detailOf, fitnessLine, itemsForDay, rotationFor } from '../www/fitness.js'
import { monthDays, monthMatrix, monthTitle, shiftMonth } from '../www/calendar.js'

let passed = 0
let failed = 0

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    passed += 1
  } else {
    failed += 1
    console.error(`FAIL ${name}\n  got:      ${a}\n  expected: ${e}`)
  }
}

// 日期工具
check('dateKey 本地日期', dateKey(new Date(2026, 10, 3)), '2026-11-03')
check('weekdayOf 周二', weekdayOf('2026-11-03'), 2)
check('daysBetween', daysBetween('2026-11-03', '2026-11-10'), 7)

// 重复规则
check('once 命中', matchesDate({ kind: 'once', date: '2026-11-03' }, '2026-11-03'), true)
check('once 不命中', matchesDate({ kind: 'once', date: '2026-11-03' }, '2026-11-04'), false)
check('daily 天天命中', matchesDate({ kind: 'daily' }, '2026-11-04'), true)
check('weekly 命中周二', matchesDate({ kind: 'weekly', days: [2] }, '2026-11-03'), true)
check('weekly 不命中周三', matchesDate({ kind: 'weekly', days: [2] }, '2026-11-04'), false)
check('everyN 每3天-第0天', matchesDate({ kind: 'everyN', n: 3, anchor: '2026-11-03' }, '2026-11-03'), true)
check('everyN 每3天-第3天', matchesDate({ kind: 'everyN', n: 3, anchor: '2026-11-03' }, '2026-11-06'), true)
check('everyN 每3天-第1天', matchesDate({ kind: 'everyN', n: 3, anchor: '2026-11-03' }, '2026-11-04'), false)
check('everyN 不早于锚点', matchesDate({ kind: 'everyN', n: 3, anchor: '2026-11-03' }, '2026-11-02'), false)

// 倒计时分级
const now = new Date('2026-11-03T12:00:00')
const in3h = new Date('2026-11-03T15:00:00').toISOString()
const in10h = new Date('2026-11-03T22:00:00').toISOString()
const in30h = new Date('2026-11-04T18:00:00').toISOString()
const in72h = new Date('2026-11-06T12:00:00').toISOString()

check('倒计时 3 小时=orange', countdown(in3h, now).level, 'orange')
check('倒计时 10 小时=yellow', countdown(in10h, now).level, 'yellow')
check('倒计时 30 小时=green', countdown(in30h, now).level, 'green')
check('倒计时 72 小时=calm', countdown(in72h, now).level, 'calm')
check('无截止返回 null', countdown(null, now), null)
check('阈值可配置（红=5小时）', countdown(in3h, now, { ...DEFAULT_THRESHOLDS, red: 5 }).level, 'red')

// 文案
check('剩余文案 小时', formatRemaining(2 * 3600000 + 15 * 60000), '剩 2小时15分')
check('剩余文案 分钟', formatRemaining(25 * 60000), '剩 25分钟')
check('超时文案', formatRemaining(-65 * 60000), '已超时 1小时5分')

// 日投影：常挂任务每天出现、完成后按天独立
const tasks = [
  { id: 'a', title: '写方案', type: 'main', repeat: { kind: 'daily' }, deadline: '2026-11-03T15:00:00Z' },
  { id: 'b', title: '买牛奶', type: 'side', repeat: { kind: 'once', date: '2026-11-03' } },
  { id: 'c', title: '俯卧撑', type: 'fitness', repeat: { kind: 'daily' } },
  { id: 'd', title: '已归档', type: 'main', repeat: { kind: 'daily' }, archivedAt: '2026-11-01' },
]
const done = { 'a@2026-11-03': true }
const groups = projectDay(tasks, done, '2026-11-03')

check('主线数量', groups.main.length, 1)
check('主线已完成', groups.main[0].done, true)
check('支线数量', groups.side.length, 1)
check('健身数量', groups.fitness.length, 1)
check('归档的任务不出现', groups.main.some((g) => g.task.id === 'd'), false)

// 次日常挂任务重现，且完成状态不串天
const nextDay = projectDay(tasks, done, '2026-11-04')
check('次日主线重现', nextDay.main.length, 1)
check('次日完成状态独立', nextDay.main[0].done, false)
check('次日一次性任务消失', nextDay.side.length, 0)

// 日历打点：只有真的有任务的那天才算
check('有任务的日子', hasAnyTask(tasks, {}, '2026-11-03'), true)
check(
  '没任务的日子',
  hasAnyTask([{ id: 'x', title: '一次性', type: 'side', repeat: { kind: 'once', date: '2026-11-05' } }], {}, '2026-11-06'),
  false,
)

/* ---------------- 健身轮换 ---------------- */
check('基准日当天是力量日', rotationFor('2026-11-03', '2026-11-03'), 'strength')
check('隔一天是有氧日', rotationFor('2026-11-03', '2026-11-04'), 'cardio')
check('隔两天回到力量日', rotationFor('2026-11-03', '2026-11-05'), 'strength')
check('基准日之前也交替', rotationFor('2026-11-03', '2026-11-02'), 'cardio')
check('没有基准日默认力量日', rotationFor('', '2026-11-03'), 'strength')

const settings = { fitnessAnchor: '2026-11-03', fitnessOverride: null }
check('未手动切换时按轮换', dayKind(settings, '2026-11-04'), 'cardio')
check(
  '当天手动切换生效',
  dayKind({ ...settings, fitnessOverride: { date: '2026-11-04', day: 'strength' } }, '2026-11-04'),
  'strength',
)
check(
  '手动切换不跨天',
  dayKind({ ...settings, fitnessOverride: { date: '2026-11-04', day: 'strength' } }, '2026-11-05'),
  'strength',
)

check('力量文案 组×个', detailOf({ day: 'strength', sets: 4, reps: 8 }), '4 组 × 8 个')
check('力量文案 只有组数', detailOf({ day: 'strength', sets: 4 }), '4 组')
check('有氧文案 时长+距离', detailOf({ day: 'cardio', minutes: 30, km: 5 }), '30 分钟 / 5 km')
check('有氧文案 只有时长', detailOf({ day: 'cardio', minutes: 30 }), '30 分钟')
check('有氧文案 只有距离', detailOf({ day: 'cardio', km: 3 }), '3 km')

const fitnessItems = [
  { id: 'f1', name: '卧推', day: 'strength', repeat: { kind: 'daily' }, createdAt: '2026-11-01' },
  { id: 'f2', name: '引体', day: 'strength', repeat: { kind: 'weekly', days: [5] }, createdAt: '2026-11-02' },
  { id: 'f3', name: '跑步', day: 'cardio', repeat: { kind: 'daily' }, createdAt: '2026-11-03' },
]
check('力量日只出力量项', itemsForDay(fitnessItems, 'strength', '2026-11-03').map((i) => i.name), ['卧推'])
check('周五能看到引体', itemsForDay(fitnessItems, 'strength', '2026-11-06').map((i) => i.name), ['卧推', '引体'])
check('有氧日只有跑步', itemsForDay(fitnessItems, 'cardio', '2026-11-03').map((i) => i.name), ['跑步'])
check('周三看不到周五的引体', itemsForDay(fitnessItems, 'strength', '2026-11-04').map((i) => i.name), ['卧推'])
check(
  '通知行带完成进度',
  fitnessLine(fitnessItems, 'cardio', '2026-11-03', { 'f3@2026-11-03': true }),
  '健身 有氧日 1/1',
)
check('没有健身项就没有通知行', fitnessLine([], 'strength', '2026-11-03', {}), null)

/* ---------------- 月历 ---------------- */
check('2026-11 有 30 天', monthDays(2026, 11).length, 30)
check('2026-02 有 28 天', monthDays(2026, 2).length, 28)
check('2026-11-01 是周日', weekdayOf('2026-11-01'), 0)
const nov2026 = monthMatrix(2026, 11, '2026-11-03')
check('11 月需要 6 行', nov2026.length, 6)
check('周一开头', nov2026[0][0].key, '2026-10-26')
check('1 号在第 1 行最后一格', nov2026[0][6].key, '2026-11-01')
check('1 号属于本月', nov2026[0][6].inMonth, true)
check('今天被标出来', nov2026.some((week) => week.some((cell) => cell.today)), true)
check(
  '所有格子都是 7 天且 key 合法',
  nov2026.every((week) => week.length === 7 && week.every((cell) => /^\d{4}-\d{2}-\d{2}$/.test(cell.key))),
  true,
)
check('翻月 12 月 → 次年 1 月', shiftMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 })
check('翻月 1 月 → 上一年 12 月', shiftMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 })
check('月份标题', monthTitle(2026, 11), '2026 年 11 月')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
