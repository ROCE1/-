// 纯逻辑的回归测试：node scripts/test-model.mjs
import {
  dateKey,
  daysBetween,
  weekdayOf,
  matchesDate,
  formatRemaining,
  countdown,
  projectDay,
  DEFAULT_THRESHOLDS,
} from '../www/model.js'

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

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
