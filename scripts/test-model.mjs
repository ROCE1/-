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
  moveInList,
  leadMinutesFor,
  escalatesToUrgent,
  nearestDeadline,
  dayLines,
  DEFAULT_THRESHOLDS,
} from '../www/model.js'
import { dayKind, detailOf, fitnessLine, itemsForDay, rotationFor } from '../www/fitness.js'
import { monthDays, monthMatrix, monthTitle, shiftMonth } from '../www/calendar.js'
import {
  busyIntervals,
  overlapMs,
  percentLabel,
  startOfMonth,
  startOfWeek,
  summarize,
  summarizeRange,
  formatDuration,
} from '../www/stats.js'

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

/* ---------------- 手动排序 ---------------- */
const ids = ['a', 'b', 'c']
check('上移一格', moveInList(ids, 'b', -1), ['b', 'a', 'c'])
check('下移一格', moveInList(ids, 'b', 1), ['a', 'c', 'b'])
check('第一项上移无效', moveInList(ids, 'a', -1), ['a', 'b', 'c'])
check('最后一项下移无效', moveInList(ids, 'c', 1), ['a', 'b', 'c'])
check('找不到的 id 原样返回', moveInList(ids, 'zz', 1), ['a', 'b', 'c'])
check('不修改入参', (() => {
  moveInList(ids, 'a', 1)
  return ids
})(), ['a', 'b', 'c'])

const ordered = [
  { id: 'o2', title: '第二', type: 'main', repeat: { kind: 'daily' }, order: 2 },
  { id: 'o0', title: '第零', type: 'main', repeat: { kind: 'daily' }, order: 0, deadline: '2026-11-03T23:00:00Z' },
  { id: 'o1', title: '第一', type: 'main', repeat: { kind: 'daily' }, order: 1 },
]
check('手动排序优先于截止时间', projectDay(ordered, {}, '2026-11-03').main.map((e) => e.task.id), ['o0', 'o1', 'o2'])

const mixedOrder = [
  { id: 'free', title: '没排序', type: 'side', repeat: { kind: 'daily' } },
  { id: 'pinned', title: '排过序', type: 'side', repeat: { kind: 'daily' }, order: 5 },
]
check('排过序的排在没排序的前面', projectDay(mixedOrder, {}, '2026-11-03').side.map((e) => e.task.id), ['pinned', 'free'])

/* ---------------- 统计 ---------------- */
const t = (hhmm) => new Date(`2026-11-03T${hhmm}:00`).getTime()
const nowAt = new Date('2026-11-03T12:00:00')

const merged = busyIntervals(
  [
    { kind: 'busy', start: new Date(t('09:00')).toISOString(), end: new Date(t('10:00')).toISOString() },
    { kind: 'busy', start: new Date(t('09:30')).toISOString(), end: new Date(t('10:30')).toISOString() },
  ],
  nowAt.getTime(),
)
check('重叠的忙碌区间会合并', merged.length, 1)
check('合并后边界正确', [merged[0][0], merged[0][1]], [t('09:00'), t('10:30')])

const open = busyIntervals(
  [{ kind: 'busy', start: new Date(t('11:00')).toISOString(), end: null }],
  nowAt.getTime(),
)
check('未结束的会话算到当前时刻', [open[0][0], open[0][1]], [t('11:00'), nowAt.getTime()])
check('坏数据被丢掉', busyIntervals([{ kind: 'busy', start: 'nope', end: null }], nowAt.getTime()).length, 0)
check('非 busy 会话不参与统计', busyIntervals([{ kind: 'idle', start: new Date(t('09:00')).toISOString(), end: new Date(t('10:00')).toISOString() }], nowAt.getTime()).length, 0)

check('裁剪到时间段内', overlapMs([[t('09:00'), t('11:00')]], t('10:00'), t('10:30')), 30 * 60000)
check('完全不重叠为 0', overlapMs([[t('09:00'), t('10:00')]], t('11:00'), t('12:00')), 0)

const sessions = [
  { kind: 'busy', start: new Date(t('09:00')).toISOString(), end: new Date(t('10:00')).toISOString() },
  { kind: 'busy', start: new Date(t('11:00')).toISOString(), end: null },
]
const summary = summarize(sessions, nowAt)
check('今日忙碌 2 小时', summary.today.busyMs, 2 * 3600000)
check('今日已过 12 小时', summary.today.elapsedMs, 12 * 3600000)
check('今日空闲 10 小时', summary.today.idleMs, 10 * 3600000)
check('今日占比约 16.7%', percentLabel(summary.today.percent), '16.7%')
check('一周从周一开始', startOfWeek(nowAt), new Date('2026-11-02T00:00:00').getTime())
check('本周已过 36 小时', summary.week.elapsedMs, 36 * 3600000)
check('本周忙碌同样 2 小时', summary.week.busyMs, 2 * 3600000)

check('时长文案 带分钟', formatDuration(2 * 3600000 + 15 * 60000), '2 小时 15 分')
check('时长文案 整点', formatDuration(2 * 3600000), '2 小时')
check('时长文案 不足一小时', formatDuration(25 * 60000), '25 分钟')
check('时长文案 零', formatDuration(0), '0 分钟')
check('百分比 0', percentLabel(0), '0%')
check('百分比 100', percentLabel(1), '100%')

// 本月区间
check('本月初', startOfMonth(nowAt), new Date('2026-11-01T00:00:00').getTime())
const monthSummary = summarize(sessions, nowAt)
check('本月已过 60 小时', monthSummary.month.elapsedMs, 60 * 3600000)
check('本月忙碌 2 小时', monthSummary.month.busyMs, 2 * 3600000)
const weekRange = summarizeRange(sessions, startOfWeek(nowAt), nowAt)
check('summarizeRange 与 week 一致', weekRange.busyMs, monthSummary.week.busyMs)
check('summarizeRange 与 week 占比一致', percentLabel(weekRange.percent), percentLabel(monthSummary.week.percent))

/* ---------------- 提前提醒 ---------------- */
check('任务自己的提前量优先', leadMinutesFor({ leadMinutes: 5 }, { leadMinutes: 30 }), 5)
check('没设就退回全局', leadMinutesFor({ leadMinutes: null }, { leadMinutes: 30 }), 30)
check('都没有就用 15', leadMinutesFor({}, {}), 15)
check('0 视为没设置', leadMinutesFor({ leadMinutes: 0 }, { leadMinutes: 20 }), 20)
check('负数视为没设置', leadMinutesFor({ leadMinutes: -5 }, {}), 15)

/* ---------------- 24 小时内自动升级为紧急 ---------------- */
const fixedNow = new Date('2026-11-04T12:00:00').getTime()
const inHours = (h) => new Date(fixedNow + h * 3600000).toISOString()

check('临时任务 20 小时内到期 → 升级', escalatesToUrgent({ deadline: inHours(20), repeat: { kind: 'once' } }, fixedNow), true)
check('临时任务 30 小时后到期 → 不升级', escalatesToUrgent({ deadline: inHours(30), repeat: { kind: 'once' } }, fixedNow), false)
check('常挂任务不升级', escalatesToUrgent({ deadline: inHours(2), repeat: { kind: 'daily' } }, fixedNow), false)
check('没有截止不升级', escalatesToUrgent({ repeat: { kind: 'once' } }, fixedNow), false)
check('已过期也算（会升级）', escalatesToUrgent({ deadline: inHours(-3), repeat: { kind: 'once' } }, fixedNow), true)

const escalateTasks = [
  { id: 'e1', title: '快到期', type: 'side', repeat: { kind: 'once', date: '2026-11-04' }, deadline: inHours(3) },
  { id: 'e2', title: '还早', type: 'side', repeat: { kind: 'once', date: '2026-11-04' }, deadline: inHours(40) },
  { id: 'e3', title: '常挂带截止', type: 'side', repeat: { kind: 'daily' }, deadline: inHours(1) },
  { id: 'e4', title: '本来就是紧急', type: 'urgent', repeat: { kind: 'daily' } },
]
const escalated = projectDay(escalateTasks, {}, '2026-11-04', fixedNow)
check('快到期的支线进了紧急区', escalated.urgent.map((e) => e.task.id).sort(), ['e1', 'e4'])
check('还早的支线留在支线', escalated.side.map((e) => e.task.id).sort(), ['e2', 'e3'])
check('升级项有标记', escalated.urgent.find((e) => e.task.id === 'e1').escalated, true)
check('看历史日期不升级', projectDay(escalateTasks, {}, '2026-11-03', fixedNow).urgent.map((e) => e.task.id), ['e4'])

/* ---------------- 通知只选一条 ---------------- */
const notifyGroups = {
  urgent: [{ task: { id: 'u1', title: '紧急A', deadline: inHours(5) }, done: false }],
  side: [
    { task: { id: 's1', title: '支线近', deadline: inHours(2) }, done: false },
    { task: { id: 's2', title: '支线远', deadline: inHours(9) }, done: false },
    { task: { id: 's3', title: '已完成', deadline: inHours(1) }, done: true },
  ],
  daily: [{ task: { id: 'd1', title: '日常无截止' }, done: false }],
  main: [{ task: { id: 'm1', title: '主线', deadline: inHours(1) }, done: false }],
}
const nearest = nearestDeadline(notifyGroups)
check('通知挑最近的一条', nearest?.entry.task.id, 's1')
check('主线不进通知候选', nearest?.type, 'side')
check('没有带截止的任务时返回 null', nearestDeadline({ urgent: [], side: [], daily: [] }), null)

/* ---------------- 小组件清单（顺序与 App 一致） ---------------- */
const widgetGroups = {
  urgent: [{ task: { id: 'w1', title: '交报告' }, done: false }],
  side: [{ task: { id: 'w2', title: '买牛奶' }, done: true }],
  daily: [{ task: { id: 'w3', title: '喝水' }, done: false }],
  main: [{ task: { id: 'w4', title: '学英语' }, done: false }],
}
check('小组件清单按 紧急→支线→日常→主线', dayLines(widgetGroups), [
  '紧急 交报告',
  '支线 买牛奶 ✓',
  '日常 喝水',
  '主线 学英语',
])
check('小组件清单可截断', dayLines(widgetGroups, { limit: 2 }), ['紧急 交报告', '支线 买牛奶 ✓'])
check(
  '小组件清单可带倒计时',
  dayLines(
    { urgent: [{ task: { id: 'x', title: '交报告' }, done: false }, { task: { id: 'y', title: '已做完' }, done: true }] },
    { suffix: (entry) => (entry.done ? '' : ' · 剩 2小时') },
  ),
  ['紧急 交报告 · 剩 2小时', '紧急 已做完 ✓'],
)
check('没有任务时清单为空', dayLines({ urgent: [], side: [], daily: [], main: [] }), [])

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
