import {
  dateKey,
  countdown,
  dayLines,
  hasAnyTask,
  leadMinutesFor,
  moveInList,
  nearestDeadline,
  projectDay,
  weekdayOf,
  TYPE_LABELS,
  TYPE_ORDER,
} from './model.js'
import * as store from './store.js'
import * as native from './native.js'
import { apply as applyTheme, current as currentTheme, list as listThemes } from './themes.js'
import { DAY_LABEL, dayKind, detailOf, itemsForDay, rotationFor } from './fitness.js'
import { monthDays, monthMatrix, monthTitle, shiftMonth } from './calendar.js'
import { formatDuration, percentLabel, startOfDay, startOfMonth, startOfWeek, summarizeRange } from './stats.js'

const SOURCE = { owner: 'ROCE1', repo: '-', mirror: 'https://gh-proxy.com/' }
const WEEK_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
// 紧急 → 支线 → 日常 → 主线（界面和通知都用这个顺序）
const TASK_TYPES = TYPE_ORDER
const TYPE_LABEL = TYPE_LABELS
// 主线和日常是常挂任务：表单里不显示截止/重复/提醒这些选项
const ALWAYS_ON_TYPES = ['main', 'daily']
const MAX_BG_EDGE = 1600

const state = {
  tab: 'today',
  date: dateKey(),
  calendarDate: dateKey(),
  month: monthOf(dateKey()),
  sortMode: false,
  statsRange: 'week',
  cardQuery: '',
  cardTag: '',
  expanded: new Set(),
  tasks: [],
  fitness: [],
  done: {},
  settings: null,
  editing: null,
  editingFitness: null,
  editingCard: null,
  editorDate: dateKey(),
  summaryDate: dateKey(),
  background: null,
  env: 'web',
  version: '—',
  update: null,
}

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function monthOf(key) {
  const [year, month] = key.split('-').map(Number)
  return { year, month }
}

function iconButton(glyph, label, onClick) {
  const button = el('button', 'cal-nav', glyph)
  button.type = 'button'
  button.setAttribute('aria-label', label)
  button.addEventListener('click', onClick)
  return button
}

async function reload() {
  state.tasks = await store.listTasks()
  state.fitness = await store.listFitnessItems()
  state.done = await store.doneMapFor(state.date)
  state.doneIds = await store.doneTaskIds()
  state.settings = await store.loadSettings()
}

/* ---------------- 原生通知与闹钟 ---------------- */

// 常驻通知只显示一条：最早到期的那个任务（主线不上横幅）
function panelLine(groups) {
  const nearest = nearestDeadline(groups)
  if (!nearest) return null
  const info = countdown(nearest.entry.task.deadline, new Date(), state.settings?.countdownThresholds)
  return `${TYPE_LABEL[nearest.type]} ${nearest.entry.task.title}${info ? ` · ${info.label}` : ''}`
}

/**
 * 把“今天该显示什么、该在什么时间提醒”同步给原生层。
 * 每次任务/状态变化都重排一次：先清空旧闹钟再注册，避免删掉的任务还在响。
 *
 * 通知标题放任务本身（锁屏空间有限，前面不再加「空闲 · 今日任务」这种前缀），
 * 状态和进度挪到正文；桌面小组件单独拿一份完整清单（widgetTitle/widgetBody）。
 */
async function refreshNotifications() {
  if (!native.isNative()) return
  const groups = projectDay(state.tasks, state.done, state.date, Date.now(), state.doneIds)
  const busy = Boolean(state.settings?.busy)
  const line = panelLine(groups)

  const total = TASK_TYPES.reduce((sum, type) => sum + groups[type].length, 0)
  const doneCount = TASK_TYPES.reduce((sum, type) => sum + groups[type].filter((i) => i.done).length, 0)

  await native.syncState({
    title: line || '今日任务',
    text: `${busy ? '繁忙中' : '空闲'} · 已完成 ${doneCount}/${total}`,
    busy,
    progressDone: doneCount,
    progressTotal: total,
    widgetTitle: `今日任务 ${doneCount}/${total}`,
    // 小组件也要倒计时：没完成且带截止的，后面缀上「· 剩 2小时」
    widgetBody:
      dayLines(groups, {
        suffix: (entry) => {
          if (entry.done || !entry.task.deadline) return ''
          const info = countdown(entry.task.deadline, new Date(), state.settings?.countdownThresholds)
          return info ? ` · ${info.label}` : ''
        },
      }).join('\n') || '今天还没有任务',
    widgetColor: state.settings?.widgetColor || '#171a21',
    widgetOpacity: Number.isFinite(state.settings?.widgetOpacity) ? state.settings.widgetOpacity : 0.95,
  })

  await native.cancelAll()
  const nowMs = Date.now()
  const now = new Date()

  // 每日总结：默认 22:00，过点则排到明天
  const [summaryHour, summaryMinute] = String(state.settings?.summaryTime || '22:00').split(':').map(Number)
  const summaryAt = new Date(now)
  summaryAt.setHours(summaryHour || 22, summaryMinute || 0, 0, 0)
  if (summaryAt.getTime() <= nowMs) summaryAt.setDate(summaryAt.getDate() + 1)
  await native.schedule({
    id: 'summary',
    at: summaryAt.getTime(),
    title: '今日总结',
    body: '花两分钟记一下今天，顺便安排明天',
    strong: false,
  })

  // 健身整块提醒：最多 3 个时间点
  const fitnessReminders = state.settings?.fitnessReminders || []
  for (let index = 0; index < fitnessReminders.length; index += 1) {
    const reminder = fitnessReminders[index]
    if (!reminder?.time) continue
    const [hour, minute] = reminder.time.split(':').map(Number)
    let at
    if (reminder.repeat === 'once') {
      if (!reminder.date) continue
      at = new Date(`${reminder.date}T00:00:00`)
      at.setHours(hour || 0, minute || 0, 0, 0)
      if (at.getTime() <= nowMs) continue
    } else {
      at = new Date(now)
      at.setHours(hour || 0, minute || 0, 0, 0)
      if (at.getTime() <= nowMs) at.setDate(at.getDate() + 1)
    }
    await native.schedule({
      id: `fitness:${index}`,
      at: at.getTime(),
      title: `健身时间 · ${DAY_LABEL[dayKind(state.settings, dateKey(at))]}`,
      body: '该动一动了（繁忙时会跳过）',
      strong: false,
    })
  }

  for (const type of TASK_TYPES) {
    for (const entry of groups[type]) {
      if (entry.done || !entry.task.deadline) continue
      const due = new Date(entry.task.deadline).getTime()
      if (Number.isNaN(due)) continue
      const leadMinutes = leadMinutesFor(entry.task, state.settings)
      const lead = due - leadMinutes * 60000
      const strong = Boolean(entry.task.strong)
      if (lead > nowMs) {
        await native.schedule({
          id: `${entry.task.id}:lead`,
          at: lead,
          title: entry.task.title,
          body: `还有 ${leadMinutes} 分钟到期`,
          strong,
        })
      }
      if (due > nowMs && strong) {
        await native.schedule({
          id: `${entry.task.id}:due`,
          at: due,
          title: entry.task.title,
          body: '已到截止时间',
          strong: true,
        })
      }
    }
  }
}

/* ---------------- 任务行 ---------------- */

function chipFor(task) {
  if (!task.deadline) return null
  const info = countdown(task.deadline, new Date(), state.settings?.countdownThresholds)
  if (!info) return null
  return el('span', `chip chip-${info.level}`, info.label)
}

/** 左滑露出「删除」，右滑收回。 */
function attachSwipe(row) {
  let startX = 0
  let startY = 0
  let dx = 0
  let tracking = false
  let opened = false

  row.addEventListener(
    'touchstart',
    (event) => {
      const touch = event.touches[0]
      startX = touch.clientX
      startY = touch.clientY
      dx = opened ? -96 : 0
      tracking = true
    },
    { passive: true },
  )

  row.addEventListener(
    'touchmove',
    (event) => {
      if (!tracking) return
      const touch = event.touches[0]
      const moveX = touch.clientX - startX + (opened ? -96 : 0)
      const moveY = touch.clientY - startY
      if (Math.abs(moveY) > Math.abs(moveX) + 4) {
        tracking = false
        return
      }
      dx = Math.max(-96, Math.min(0, moveX))
      row.style.transform = `translateX(${dx}px)`
    },
    { passive: true },
  )

  row.addEventListener('touchend', () => {
    if (!tracking) return
    tracking = false
    opened = dx < -48
    row.style.transform = `translateX(${opened ? -96 : 0}px)`
  })
}

/** 左滑删除按钮 + 主体，任务和健身项共用这套外壳。 */
function swipeShell(onDelete) {
  const wrap = el('div', 'task-wrap')
  const remove = el('button', 'task-delete', '删除')
  remove.type = 'button'
  remove.addEventListener('click', async (event) => {
    event.stopPropagation()
    await onDelete()
  })
  return { wrap, remove }
}

function taskRow(entry, date, options = {}) {
  const { task, done } = entry
  const { sortable = false, onMove } = options
  const { wrap, remove } = swipeShell(async () => {
    await store.deleteTask(task.id)
    await reload()
    await render()
    await refreshNotifications()
  })

  const row = el('div', `task${done ? ' done' : ''}`)

  const checkbox = el('button', 'check')
  checkbox.type = 'button'
  checkbox.setAttribute('aria-label', done ? '取消完成' : '标记完成')
  checkbox.textContent = done ? '✓' : ''
  checkbox.addEventListener('click', async (event) => {
    event.stopPropagation()
    await store.setDone(task.id, date, !done)
    await reload()
    await render()
    await refreshNotifications()
  })

  const body = el('div', 'task-body')
  body.appendChild(el('div', 'task-title', task.title))

  const meta = el('div', 'task-meta')
  if (task.strong) meta.appendChild(el('span', 'badge strong', '强'))
  if (task.notes) meta.appendChild(el('span', 'badge notes-badge', '备注'))
  const chip = chipFor(task)
  if (chip) meta.appendChild(chip)
  if (meta.children.length) body.appendChild(meta)

  row.append(checkbox, body)

  if (sortable) {
    const arrows = el('div', 'order-buttons')
    for (const [glyph, delta, label] of [
      ['↑', -1, '上移'],
      ['↓', 1, '下移'],
    ]) {
      const button = el('button', 'order-btn', glyph)
      button.type = 'button'
      button.setAttribute('aria-label', label)
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        onMove?.(entry, delta)
      })
      arrows.appendChild(button)
    }
    row.appendChild(arrows)
  }

  // 点一下展开备注，再点收起；编辑走展开面板里的「编辑」
  const notes = el('div', 'task-notes')
  const notesInner = el('div', 'task-notes-inner')
  notesInner.appendChild(el('div', `task-notes-text${task.notes ? '' : ' muted'}`, task.notes || '没有备注'))
  const editBtn = el('button', 'link-inline', '编辑')
  editBtn.type = 'button'
  editBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    openEditor(task, date)
  })
  const actions = el('div', 'task-notes-actions')
  actions.appendChild(editBtn)
  notesInner.appendChild(actions)
  notes.appendChild(notesInner)

  notes.classList.toggle('open', state.expanded.has(task.id))

  row.addEventListener('click', (event) => {
    event.stopPropagation()
    if (state.expanded.has(task.id)) state.expanded.delete(task.id)
    else state.expanded.add(task.id)
    notes.classList.toggle('open', state.expanded.has(task.id))
  })
  attachSwipe(row)

  wrap.append(remove, row)

  const block = el('div', 'task-block')
  block.append(wrap, notes)
  return block
}

function section(type, entries, date, rowOptions) {
  const wrap = el('section', `group group-${type}`)
  const head = el('div', 'group-head')
  head.append(el('span', 'group-title', TYPE_LABEL[type]), el('span', 'group-count', String(entries.length)))
  wrap.appendChild(head)
  if (entries.length === 0) wrap.appendChild(el('div', 'empty', `没有${TYPE_LABEL[type]}任务`))
  else for (const entry of entries) wrap.appendChild(taskRow(entry, date, rowOptions))
  return wrap
}

/* ---------------- 今日 ---------------- */

/** 手动排序：把同类型里这一条上移/下移一格，然后把整组重新编号并落库。 */
async function moveTask(entry, delta) {
  const groups = projectDay(state.tasks, state.done, state.date, Date.now(), state.doneIds)
  const ids = groups[entry.task.type].map((item) => item.task.id)
  const next = moveInList(ids, entry.task.id, delta)
  if (next.every((id, index) => id === ids[index])) return

  await Promise.all(
    next.map((id, index) => {
      const task = state.tasks.find((item) => item.id === id)
      return task ? store.saveTask({ ...task, order: index }) : null
    }),
  )
  await reload()
  await rerender()
}

/** 新建任务：如果这一类型已经有人排过序，就接在最后面。 */
function nextOrderFor(type) {
  const siblings = state.tasks.filter((item) => item.type === type && Number.isFinite(item.order))
  return siblings.length ? Math.max(...siblings.map((item) => item.order)) + 1 : undefined
}

function renderToday() {
  const groups = projectDay(state.tasks, state.done, state.date, Date.now(), state.doneIds)
  const view = $('#view')
  view.replaceChildren()

  const bar = el('div', 'list-bar')
  if (state.sortMode) bar.appendChild(el('span', 'list-hint', '用 ↑ ↓ 调整顺序，调完点「完成」'))
  const sortButton = el('button', `chip-toggle${state.sortMode ? ' active' : ''}`, state.sortMode ? '完成' : '排序')
  sortButton.type = 'button'
  sortButton.addEventListener('click', () => {
    state.sortMode = !state.sortMode
    rerender()
  })
  bar.appendChild(sortButton)
  view.appendChild(bar)

  const rowOptions = state.sortMode ? { sortable: true, onMove: (entry, delta) => moveTask(entry, delta) } : undefined
  for (const type of TASK_TYPES) view.appendChild(section(type, groups[type], state.date, rowOptions))

  const total = TASK_TYPES.reduce((sum, type) => sum + groups[type].length, 0)
  const doneCount = TASK_TYPES.reduce((sum, type) => sum + groups[type].filter((i) => i.done).length, 0)
  $('#today-summary').textContent =
    total === 0 ? '今天还没有任务，点右下角 ＋ 新建' : `已完成 ${doneCount} / ${total}`
}

/* ---------------- 统计 ---------------- */

function ringBlock(label, data) {
  const size = 128
  const stroke = 12
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const svgNs = 'http://www.w3.org/2000/svg'

  const svg = document.createElementNS(svgNs, 'svg')
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`)
  svg.setAttribute('class', 'ring')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', `${label}工作占比 ${percentLabel(data.percent)}`)

  const track = document.createElementNS(svgNs, 'circle')
  track.setAttribute('cx', String(size / 2))
  track.setAttribute('cy', String(size / 2))
  track.setAttribute('r', String(radius))
  track.setAttribute('fill', 'none')
  track.setAttribute('stroke-width', String(stroke))
  track.setAttribute('class', 'ring-track')

  const arc = document.createElementNS(svgNs, 'circle')
  arc.setAttribute('cx', String(size / 2))
  arc.setAttribute('cy', String(size / 2))
  arc.setAttribute('r', String(radius))
  arc.setAttribute('fill', 'none')
  arc.setAttribute('stroke-width', String(stroke))
  arc.setAttribute('stroke-linecap', 'round')
  arc.setAttribute('stroke-dasharray', String(circumference))
  arc.setAttribute('stroke-dashoffset', String(circumference * (1 - Math.max(0, Math.min(1, data.percent)))))
  arc.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`)
  arc.setAttribute('class', 'ring-arc')

  svg.append(track, arc)

  const wrap = el('div', 'ring-wrap')
  wrap.append(svg, el('div', 'ring-center', percentLabel(data.percent)))

  const block = el('div', 'ring-block')
  block.append(wrap, el('div', 'ring-label', label))
  return block
}

function statRow(label, value) {
  const row = el('div', 'stat-row')
  row.append(el('span', 'muted', label), el('span', '', value))
  return row
}

async function renderStats() {
  const view = $('#view')
  view.replaceChildren()
  const sessions = await store.getAll('sessions')
  const now = new Date()

  const rangeKey = state.statsRange === 'month' ? 'month' : 'week'
  const rangeLabel = rangeKey === 'month' ? '本月' : '本周'
  const rangeStart = rangeKey === 'month' ? startOfMonth(now) : startOfWeek(now)
  const today = summarizeRange(sessions, startOfDay(now), now)
  const range = summarizeRange(sessions, rangeStart, now)

  $('#today-summary').textContent = '工作 / 空闲占比（来自「繁忙」开关）'

  // 本周 / 本月切换
  const seg = el('div', 'segmented')
  for (const [value, label] of [
    ['week', '本周'],
    ['month', '本月'],
  ]) {
    const button = el('button', `seg${rangeKey === value ? ' active' : ''}`, label)
    button.type = 'button'
    button.addEventListener('click', () => {
      state.statsRange = value
      rerender()
    })
    seg.appendChild(button)
  }

  const card = el('section', 'card stats-card')
  const rings = el('div', 'rings')
  rings.append(ringBlock('今日', today), ringBlock(rangeLabel, range))
  card.appendChild(rings)
  card.appendChild(el('div', 'stats-note muted', '空闲 = 已过去的时间 − 繁忙时长；没开 App 的时段也算空闲。'))
  view.appendChild(seg)
  view.appendChild(card)

  const detail = el('section', 'card')
  detail.append(
    statRow('今日工作', formatDuration(today.busyMs)),
    statRow('今日空闲', formatDuration(today.idleMs)),
    statRow(`${rangeLabel}工作`, formatDuration(range.busyMs)),
    statRow(`${rangeLabel}空闲`, formatDuration(range.idleMs)),
  )
  view.appendChild(detail)

  // 清空历史：数据一直累计会越来越难看出“最近怎么样”，给一个手动归零的出口
  const manage = el('section', 'card')
  manage.appendChild(el('div', 'field-label', '记录管理'))
  const countLine = el('div', 'muted', `已记录 ${sessions.filter((s) => s.kind === 'busy').length} 段繁忙时间`)
  manage.appendChild(countLine)

  const clearButton = el('button', 'ghost danger', '清空时间记录')
  clearButton.type = 'button'
  clearButton.addEventListener('click', async () => {
    const ok = window.confirm('清空所有工作/空闲记录？统计会归零，任务与日志不受影响。')
    if (!ok) return
    await store.clear('sessions')
    await rerender()
  })
  manage.appendChild(clearButton)
  view.appendChild(manage)
}

/* ---------------- 健身 ---------------- */

async function setFitnessKind(value, rotation, { clear = false } = {}) {
  const override = clear || value === rotation ? null : { date: state.date, day: value }
  state.settings.fitnessOverride = override
  await store.saveSetting('fitnessOverride', override)
  await render()
  await refreshNotifications()
}

function fitnessRow(item, date) {
  const done = Boolean(state.done[`${item.id}@${date}`])
  const { wrap, remove } = swipeShell(async () => {
    await store.deleteFitnessItem(item.id)
    await reload()
    await render()
    await refreshNotifications()
  })

  const row = el('div', `task${done ? ' done' : ''}`)

  const checkbox = el('button', 'check')
  checkbox.type = 'button'
  checkbox.setAttribute('aria-label', done ? '取消完成' : '标记完成')
  checkbox.textContent = done ? '✓' : ''
  checkbox.addEventListener('click', async (event) => {
    event.stopPropagation()
    await store.setDone(item.id, date, !done)
    await reload()
    await render()
    await refreshNotifications()
  })

  const body = el('div', 'task-body')
  body.appendChild(el('div', 'task-title', item.name))
  const detail = detailOf(item)
  if (detail) {
    const meta = el('div', 'task-meta')
    meta.appendChild(el('span', 'chip', detail))
    body.appendChild(meta)
  }

  row.append(checkbox, body)
  row.addEventListener('click', () => openFitnessEditor(item))
  attachSwipe(row)

  wrap.append(remove, row)
  return wrap
}

function renderFitness() {
  const view = $('#view')
  view.replaceChildren()

  const kind = dayKind(state.settings, state.date)
  const rotation = rotationFor(state.settings.fitnessAnchor, state.date)

  const seg = el('div', 'segmented')
  for (const value of ['strength', 'cardio']) {
    const button = el('button', `seg${value === kind ? ' active' : ''}`, DAY_LABEL[value])
    button.type = 'button'
    button.addEventListener('click', () => setFitnessKind(value, rotation))
    seg.appendChild(button)
  }
  view.appendChild(seg)

  const note = el('div', 'seg-note')
  if (kind === rotation) {
    note.textContent = `按轮换：${DAY_LABEL[rotation]}（力量 / 有氧自动交替）`
  } else {
    note.append(`今天手动切到${DAY_LABEL[kind]}，轮换本应是${DAY_LABEL[rotation]}`)
    const back = el('button', 'link-inline', '恢复自动')
    back.type = 'button'
    back.addEventListener('click', () => setFitnessKind(rotation, rotation, { clear: true }))
    note.append(back)
  }
  view.appendChild(note)

  const items = itemsForDay(state.fitness, kind, state.date)
  const doneCount = items.filter((item) => state.done[`${item.id}@${state.date}`]).length
  $('#today-summary').textContent = `${DAY_LABEL[kind]} · ${doneCount} / ${items.length} 已完成`

  if (!items.length) view.appendChild(el('div', 'empty', `今天没有${DAY_LABEL[kind]}项，点右下角 ＋ 添加`))
  else for (const item of items) view.appendChild(fitnessRow(item, state.date))
}

/* ---------------- 日历 ---------------- */

async function renderCalendar() {
  const view = $('#view')
  view.replaceChildren()

  const { year, month } = state.month
  $('#today-summary').textContent = `${monthTitle(year, month)} · 点日期查看或新建`

  const head = el('div', 'cal-head')
  const shiftTo = (delta) => {
    state.month = shiftMonth(state.month, delta)
    rerender()
  }
  head.append(
    iconButton('‹', '上一月', () => shiftTo(-1)),
    el('div', 'cal-title', monthTitle(year, month)),
    iconButton('›', '下一月', () => shiftTo(1)),
  )
  const todayButton = el('button', 'link-inline', '回到今天')
  todayButton.type = 'button'
  todayButton.addEventListener('click', () => {
    state.month = monthOf(state.date)
    state.calendarDate = state.date
    rerender()
  })
  head.appendChild(todayButton)
  view.appendChild(head)

  const weekdays = el('div', 'cal-weekdays')
  for (const label of ['一', '二', '三', '四', '五', '六', '日']) weekdays.appendChild(el('span', '', label))
  view.appendChild(weekdays)

  // 打点：只看“这天有没有任务”，不看完成状态
  const dotted = new Set()
  for (const key of monthDays(year, month)) {
    if (hasAnyTask(state.tasks, {}, key, Date.now(), state.doneIds)) dotted.add(key)
  }

  const grid = el('div', 'cal-grid')
  for (const week of monthMatrix(year, month, state.date)) {
    for (const cell of week) {
      const button = el('button', 'cal-cell', String(cell.day))
      button.type = 'button'
      button.classList.toggle('out', !cell.inMonth)
      button.classList.toggle('today', cell.today)
      button.classList.toggle('selected', cell.key === state.calendarDate)
      if (dotted.has(cell.key)) button.appendChild(el('span', 'cal-dot'))
      button.addEventListener('click', () => {
        state.calendarDate = cell.key
        if (!cell.inMonth) state.month = monthOf(cell.key)
        rerender()
      })
      grid.appendChild(button)
    }
  }
  view.appendChild(grid)

  const selected = state.calendarDate
  const done = await store.doneMapFor(selected)
  const groups = projectDay(state.tasks, done, selected, Date.now(), state.doneIds)
  const total = TASK_TYPES.reduce((sum, type) => sum + groups[type].length, 0)

  const dayHead = el('div', 'group-head day-head')
  dayHead.append(
    el('span', 'group-title', `${selected}${selected === state.date ? ' · 今天' : ''}`),
    el('span', 'group-count', String(total)),
  )
  view.appendChild(dayHead)

  if (total === 0) view.appendChild(el('div', 'empty', '这天没有任务'))
  else for (const type of TASK_TYPES) if (groups[type].length) view.appendChild(section(type, groups[type], selected))

  const add = el('button', 'ghost', `在 ${selected} 新建任务`)
  add.type = 'button'
  add.addEventListener('click', () => openEditor(null, selected))
  view.appendChild(add)
}

/* ---------------- 记录 ---------------- */

function snippetOf(entry) {
  const text = String(entry?.summary || '').replace(/\s+/g, ' ').trim()
  if (!text) return '（没写工作总结）'
  return text.length > 48 ? `${text.slice(0, 48)}…` : text
}

async function renderRecords() {
  const view = $('#view')
  const [journals, cards] = await Promise.all([store.getAll('journal'), store.getAll('cards')])
  journals.sort((a, b) => String(b.date).localeCompare(String(a.date)))
  cards.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  view.replaceChildren()
  $('#today-summary').textContent = `${journals.length} 篇总结 · ${cards.length} 张记录卡`

  // 每日总结
  const journalGroup = el('section', 'group')
  const journalHead = el('div', 'group-head')
  journalHead.append(el('span', 'group-title', '每日总结'), el('span', 'group-count', String(journals.length)))
  journalGroup.appendChild(journalHead)

  if (journals.length === 0) journalGroup.appendChild(el('div', 'empty', '还没有写过总结'))
  for (const entry of journals) {
    const row = el('button', 'journal-row')
    row.type = 'button'
    const weekday = WEEK_LABEL[weekdayOf(entry.date)] || ''
    const dateCell = el('span', 'journal-date')
    dateCell.append(el('span', 'journal-day', entry.date), el('span', 'journal-weekday', weekday))
    const bodyCell = el('span', 'journal-body')
    bodyCell.appendChild(el('span', 'journal-snippet', snippetOf(entry)))
    const plan = String(entry.planFree || '').replace(/\s+/g, ' ').trim()
    if (plan) {
      bodyCell.appendChild(el('span', 'journal-plan', `明日：${plan.length > 36 ? `${plan.slice(0, 36)}…` : plan}`))
    }
    row.append(dateCell, bodyCell)
    row.addEventListener('click', () => openSummary(entry.date))
    journalGroup.appendChild(row)
  }

  const writeButton = el('button', 'ghost', '写今天的总结')
  writeButton.type = 'button'
  writeButton.addEventListener('click', () => openSummary(state.date))
  journalGroup.appendChild(writeButton)
  view.appendChild(journalGroup)

  // 记录卡（带检索）
  const cardGroup = el('section', 'group')
  const cardHead = el('div', 'group-head')
  const cardCount = el('span', 'group-count', String(cards.length))
  cardHead.append(el('span', 'group-title', '记录卡'), cardCount)
  cardGroup.appendChild(cardHead)

  const searchRow = el('div', 'search-row')
  const searchInput = document.createElement('input')
  searchInput.type = 'search'
  searchInput.placeholder = '搜索标题、内容或标签'
  searchInput.value = state.cardQuery
  const clearSearch = el('button', 'link-inline', '清空')
  clearSearch.type = 'button'
  clearSearch.addEventListener('click', () => {
    state.cardQuery = ''
    state.cardTag = ''
    searchInput.value = ''
    for (const node of tagBar.children) node.classList.remove('active')
    renderCards()
  })
  searchRow.append(searchInput, clearSearch)
  cardGroup.appendChild(searchRow)

  const allTags = [...new Set(cards.flatMap((card) => card.tags || []))].sort((a, b) => a.localeCompare(b, 'zh'))
  const tagBar = el('div', 'tag-bar')
  for (const tag of allTags) {
    const chip = el('button', `tag-chip${state.cardTag === tag ? ' active' : ''}`, `#${tag}`)
    chip.type = 'button'
    chip.addEventListener('click', () => {
      state.cardTag = state.cardTag === tag ? '' : tag
      for (const node of tagBar.children) node.classList.toggle('active', node === chip && state.cardTag === tag)
      renderCards()
    })
    tagBar.appendChild(chip)
  }
  if (allTags.length) cardGroup.appendChild(tagBar)

  const list = el('div', 'card-list')
  cardGroup.appendChild(list)

  function cardItem(card) {
    const item = el('section', 'card')
    const top = el('div', 'card-head')
    top.appendChild(el('div', 'card-title', card.title || '未命名'))

    const actions = el('div', 'card-actions')
    const edit = el('button', 'link-inline', '编辑')
    edit.type = 'button'
    edit.addEventListener('click', () => openCardEditor(card))
    const del = el('button', 'link-danger', '删除')
    del.type = 'button'
    del.addEventListener('click', async () => {
      await store.remove('cards', card.id)
      await render()
    })
    actions.append(edit, del)
    top.appendChild(actions)

    item.appendChild(top)
    item.appendChild(el('div', 'muted', new Date(card.createdAt).toLocaleString('zh-CN')))
    item.appendChild(el('div', 'card-body', card.body))
    if (card.tags?.length) item.appendChild(el('div', 'muted', card.tags.map((tag) => `#${tag}`).join(' ')))
    return item
  }

  function renderCards() {
    const query = state.cardQuery.trim().toLowerCase()
    const filtered = cards.filter((card) => {
      if (state.cardTag && !(card.tags || []).includes(state.cardTag)) return false
      if (!query) return true
      const haystack = `${card.title || ''}\n${card.body || ''}\n${(card.tags || []).join(' ')}`.toLowerCase()
      return haystack.includes(query)
    })

    cardCount.textContent = query || state.cardTag ? `${filtered.length}/${cards.length}` : String(cards.length)
    list.replaceChildren()
    if (cards.length === 0) {
      list.appendChild(el('div', 'empty', '还没有记录卡。它和每日日志不同：随时写、可多条。'))
      return
    }
    if (filtered.length === 0) {
      list.appendChild(el('div', 'empty', '没有匹配的记录卡'))
      return
    }
    for (const card of filtered) list.appendChild(cardItem(card))
  }

  searchInput.addEventListener('input', () => {
    state.cardQuery = searchInput.value
    renderCards()
  })

  renderCards()

  const addCard = el('button', 'primary', '写一张记录卡')
  addCard.type = 'button'
  addCard.addEventListener('click', () => openCardEditor(null))
  cardGroup.appendChild(addCard)
  view.appendChild(cardGroup)
}

/** 记录卡：新建和编辑共用同一个弹窗。 */
function openCardEditor(card) {
  state.editingCard = card || null
  const form = $('#card-form')
  form.reset()
  $('#card-dialog-title').textContent = card ? '编辑记录卡' : '新记录卡'
  if (card) {
    form.elements.title.value = card.title || ''
    form.elements.body.value = card.body || ''
    form.elements.tags.value = (card.tags || []).join(',')
  }
  $('#card-dialog').showModal()
}

/* ---------------- 每日总结 ---------------- */

function summaryDue() {
  const [hour, minute] = String(state.settings?.summaryTime || '22:00').split(':').map(Number)
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes() >= hour * 60 + minute
}

async function openSummary(date) {
  state.summaryDate = date
  const done = await store.doneMapFor(date)
  const groups = projectDay(state.tasks, done, date, Date.now(), state.doneIds)
  const doneList = []
  for (const type of TASK_TYPES) {
    for (const entry of groups[type]) if (entry.done) doneList.push(entry.task.title)
  }
  $('#summary-title').textContent = `${date} 总结`
  $('#summary-done').textContent = doneList.length
    ? `已完成 ${doneList.length} 项：${doneList.join('、')}`
    : '这天没有完成任何任务'

  const existing = await store.getOne('journal', date)
  const form = $('#summary-form')
  form.elements.summary.value = existing?.summary || ''
  form.elements.plan.value = existing?.planFree || ''
  $('#summary-dialog').showModal()
}

/* ---------------- 任务编辑器 ---------------- */

function syncRepeatFields() {
  const kind = $('#repeat-kind').value
  for (const field of $$('[data-repeat]')) field.hidden = field.dataset.repeat !== kind
}

function syncFitnessFields() {
  const day = $('#fitness-day').value
  for (const field of $$('#fitness-form [data-fday]')) field.hidden = field.dataset.fday !== day

  const kind = $('#fitness-repeat-kind').value
  for (const field of $$('#fitness-form [data-frepeat]')) field.hidden = field.dataset.frepeat !== kind
}

/** 主线和日常是常挂任务：把重复、倒计时、提醒这些选项都收起来，页面更清爽。 */
function syncTypeFields() {
  const form = $('#task-form')
  if (!form) return
  const type = form.elements.type.value
  const alwaysOn = ALWAYS_ON_TYPES.includes(type)

  for (const field of $$('#task-form [data-adv]')) field.hidden = alwaysOn
  const hint = $('#task-always-on-hint')
  if (hint) hint.hidden = !alwaysOn

  if (alwaysOn) for (const field of $$('#task-form [data-repeat]')) field.hidden = true
  else syncRepeatFields()
}

function fillForm(task) {
  const form = $('#task-form')
  form.reset()
  $('#dialog-title').textContent = task
    ? '编辑任务'
    : state.editorDate === state.date
      ? '新建任务'
      : `新建任务 · ${state.editorDate}`
  form.elements.onceDate.value = state.editorDate
  syncRepeatFields()
  if (!task) {
    syncTypeFields()
    return
  }

  form.elements.title.value = task.title
  form.elements.type.value = task.type
  form.elements.repeatKind.value = task.repeat.kind
  form.elements.deadline.value = task.deadline ? task.deadline.slice(0, 16) : ''
  form.elements.strong.checked = Boolean(task.strong)
  form.elements.leadMinutes.value = task.leadMinutes ?? ''
  form.elements.notes.value = task.notes || ''
  if (task.repeat.kind === 'once') form.elements.onceDate.value = task.repeat.date
  if (task.repeat.kind === 'everyN') form.elements.everyN.value = task.repeat.n
  if (task.repeat.kind === 'weekly') {
    for (const option of form.elements.weeklyDays.options) {
      option.selected = task.repeat.days.includes(Number(option.value))
    }
  }
  syncTypeFields()
}

function openEditor(task, date) {
  state.editing = task || null
  state.editorDate = date || state.date
  fillForm(task)
  $('#task-dialog').showModal()
}

function readForm() {
  const form = $('#task-form')
  const type = form.elements.type.value
  const normalizedType = TASK_TYPES.includes(type) ? type : 'main'
  const alwaysOn = ALWAYS_ON_TYPES.includes(normalizedType)

  // 常挂任务：不写重复规则明细、不要截止/提醒，避免表单收起后还残留旧值
  if (alwaysOn) {
    return {
      title: form.elements.title.value.trim(),
      type: normalizedType,
      repeat: { kind: 'daily' },
      deadline: null,
      strong: false,
      leadMinutes: null,
      notes: form.elements.notes.value.trim(),
    }
  }

  const kind = form.elements.repeatKind.value
  let repeat
  if (kind === 'once') repeat = { kind, date: form.elements.onceDate.value || state.editorDate }
  else if (kind === 'weekly') {
    const days = Array.from(form.elements.weeklyDays.selectedOptions).map((o) => Number(o.value))
    repeat = { kind, days: days.length ? days : [new Date().getDay()] }
  } else if (kind === 'everyN') {
    repeat = { kind, n: Number(form.elements.everyN.value) || 1, anchor: state.editorDate }
  } else repeat = { kind: 'daily' }

  const deadlineValue = form.elements.deadline.value
  const leadMinutes = Number(form.elements.leadMinutes.value)
  return {
    title: form.elements.title.value.trim(),
    type: normalizedType,
    repeat,
    deadline: deadlineValue ? new Date(deadlineValue).toISOString() : null,
    strong: form.elements.strong.checked,
    leadMinutes: Number.isFinite(leadMinutes) && leadMinutes > 0 ? Math.round(leadMinutes) : null,
    notes: form.elements.notes.value.trim(),
  }
}

/* ---------------- 健身项编辑器 ---------------- */

function fillFitnessForm(item, day) {
  const form = $('#fitness-form')
  form.reset()
  $('#fitness-dialog-title').textContent = item ? '编辑健身项' : '新建健身项'
  form.elements.day.value = item?.day || day || 'strength'
  form.elements.repeatKind.value = item?.repeat?.kind || 'daily'
  form.elements.onceDate.value = state.date
  form.elements.everyN.value = item?.repeat?.n || 2
  syncFitnessFields()
  if (!item) return

  form.elements.name.value = item.name
  form.elements.sets.value = item.sets ?? ''
  form.elements.reps.value = item.reps ?? ''
  form.elements.minutes.value = item.minutes ?? ''
  form.elements.km.value = item.km ?? ''
  if (item.repeat?.kind === 'once') form.elements.onceDate.value = item.repeat.date
  if (item.repeat?.kind === 'weekly') {
    for (const option of form.elements.weeklyDays.options) {
      option.selected = (item.repeat.days || []).includes(Number(option.value))
    }
  }
  syncFitnessFields()
}

function openFitnessEditor(item, day) {
  state.editingFitness = item || null
  fillFitnessForm(item, day)
  $('#fitness-dialog').showModal()
}

function readFitnessForm() {
  const form = $('#fitness-form')
  const value = (name) => {
    const raw = form.elements[name].value
    if (raw === '') return null
    const number = Number(raw)
    return Number.isFinite(number) ? number : null
  }

  const kind = form.elements.repeatKind.value
  let repeat
  if (kind === 'once') repeat = { kind, date: form.elements.onceDate.value || state.date }
  else if (kind === 'weekly') {
    const days = Array.from(form.elements.weeklyDays.selectedOptions).map((o) => Number(o.value))
    repeat = { kind, days: days.length ? days : [new Date().getDay()] }
  } else if (kind === 'everyN') {
    repeat = { kind, n: Number(form.elements.everyN.value) || 1, anchor: state.date }
  } else repeat = { kind: 'daily' }

  const day = form.elements.day.value
  return {
    name: form.elements.name.value.trim(),
    day,
    sets: day === 'strength' ? value('sets') : null,
    reps: day === 'strength' ? value('reps') : null,
    minutes: day === 'cardio' ? value('minutes') : null,
    km: day === 'cardio' ? value('km') : null,
    repeat,
  }
}

/* ---------------- 背景图 ---------------- */

function paintBackground() {
  const root = document.documentElement.style
  const background = state.background
  if (!background?.url) {
    root.setProperty('--bg-image', 'none')
    root.setProperty('--bg-opacity', '0')
    root.setProperty('--bg-blur', '0px')
    return
  }
  root.setProperty('--bg-image', `url("${background.url}")`)
  root.setProperty('--bg-opacity', String(background.opacity))
  root.setProperty('--bg-blur', `${background.blur}px`)
}

function supportsWebp() {
  try {
    return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    return false
  }
}

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() }
    } catch {
      /* 老 WebView 不支持时退回 <img> */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    if (typeof image.decode === 'function') await image.decode()
    else await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = () => reject(new Error('图片解码失败'))
    })
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

/** 缩放到长边 ≤ MAX_BG_EDGE 再存，避免 IndexedDB 里塞进几 MB 原图。 */
async function downscaleImage(file) {
  const image = await decodeImage(file)
  try {
    const scale = Math.min(1, MAX_BG_EDGE / Math.max(image.width, image.height))
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(image.source, 0, 0, width, height)

    const type = supportsWebp() ? 'image/webp' : 'image/jpeg'
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('图片编码失败'))), type, 0.85)
    })
    return blob
  } finally {
    image.release()
  }
}

async function loadBackground() {
  const record = await store.loadBackground()
  if (!record?.blob) {
    state.background = null
    paintBackground()
    return
  }
  state.background = {
    url: URL.createObjectURL(record.blob),
    opacity: record.opacity,
    blur: record.blur,
  }
  paintBackground()
}

/** 小组件背景色，只接受 #rrggbb（原生侧用 Color.parseColor 解析）。 */
function normalizeHex(value, fallback = '#171a21') {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? String(value).toLowerCase() : fallback
}

const FONT_SCALES = { small: 0.9, normal: 1, large: 1.15, xlarge: 1.3 }
const TYPE_COLOR_FALLBACK = { urgent: '#f87171', side: '#fb923c', daily: '#4ade80', main: '#4c8dff' }

/** 把字号 / 字重 / 分类颜色写到 CSS 变量上（样式表里全是 rem 和 var）。 */
function applyAppearance() {
  const root = document.documentElement.style
  root.setProperty('--fs', String(FONT_SCALES[state.settings?.fontSize] ?? 1))
  root.setProperty('--task-weight', state.settings?.fontWeight === 'bold' ? '600' : '400')
  const colors = state.settings?.typeColors || {}
  for (const type of TASK_TYPES) {
    root.setProperty(`--type-${type}`, normalizeHex(colors[type], TYPE_COLOR_FALLBACK[type]))
  }
}

function widgetOpacityValue() {
  const value = Number(state.settings?.widgetOpacity)
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.95
}

function sliderRow({ label, value, min, max, step, onInput, onChange }) {
  const row = el('label', 'slider-row')
  const head = el('div', 'slider-head')
  const output = el('span', 'slider-value', String(value))
  head.append(el('span', '', label), output)

  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)
  input.addEventListener('input', () => {
    output.textContent = String(input.value)
    onInput(Number(input.value))
  })
  input.addEventListener('change', () => onChange?.(Number(input.value)))

  row.append(head, input)
  return row
}

function backgroundCard() {
  const card = el('section', 'card')
  card.appendChild(el('div', 'field-label', '背景'))

  const preview = el('div', 'bg-preview')
  if (state.background?.url) preview.style.backgroundImage = `url("${state.background.url}")`
  else preview.appendChild(el('div', 'bg-empty', '未设置（用主题纯色）'))
  card.appendChild(preview)

  const status = el('div', 'muted', state.background ? '背景图已启用' : '从相册选一张图，会缩到长边 1600px 再存')
  card.appendChild(status)

  const file = document.createElement('input')
  file.type = 'file'
  file.accept = 'image/*'
  file.hidden = true
  card.appendChild(file)

  const actions = el('div', 'actions')
  const choose = el('button', 'primary', state.background ? '换一张' : '选择图片')
  choose.type = 'button'
  choose.addEventListener('click', () => file.click())

  const reset = el('button', 'ghost', '恢复默认')
  reset.type = 'button'
  reset.disabled = !state.background
  reset.addEventListener('click', async () => {
    if (state.background?.url) URL.revokeObjectURL(state.background.url)
    state.background = null
    await store.clearBackground()
    paintBackground()
    await render()
  })
  actions.append(choose, reset)
  card.appendChild(actions)

  file.addEventListener('change', async () => {
    const picked = file.files?.[0]
    if (!picked) return
    choose.disabled = true
    status.textContent = '处理中…'
    try {
      const blob = await downscaleImage(picked)
      const opacity = state.background?.opacity ?? 0.45
      const blur = state.background?.blur ?? 0
      if (state.background?.url) URL.revokeObjectURL(state.background.url)
      state.background = { url: URL.createObjectURL(blob), opacity, blur }
      await store.saveBackground({ blob, opacity, blur })
      paintBackground()
      await render()
    } catch (error) {
      status.textContent = `读取图片失败：${error.message}`
      choose.disabled = false
    } finally {
      file.value = ''
    }
  })

  if (state.background) {
    card.appendChild(
      sliderRow({
        label: '透明度',
        value: Math.round(state.background.opacity * 100),
        min: 0,
        max: 100,
        step: 1,
        onInput: (value) => {
          state.background.opacity = value / 100
          paintBackground()
        },
        onChange: (value) => store.saveBackgroundTuning(value / 100, state.background?.blur ?? 0),
      }),
    )
    card.appendChild(
      sliderRow({
        label: '模糊（px）',
        value: state.background.blur,
        min: 0,
        max: 24,
        step: 1,
        onInput: (value) => {
          state.background.blur = value
          paintBackground()
        },
        onChange: (value) => store.saveBackgroundTuning(state.background?.opacity ?? 0.45, value),
      }),
    )
  }

  return card
}

/* ---------------- 更新 ---------------- */

async function nativeGetText(url) {
  const http = window.Capacitor?.Plugins?.CapacitorHttp
  if (http && typeof http.get === 'function') {
    const res = await http.get({ url, responseType: 'text' })
    if (res.status && res.status >= 400) throw new Error(`HTTP ${res.status}`)
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
  }
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function checkUpdate() {
  const status = $('#update-status')
  status.textContent = '检查中…'
  try {
    if (state.env === 'desktop') {
      const result = await window.bridge.checkUpdate()
      if (!result.ok) {
        status.textContent = result.message || '检查失败'
        return
      }
      state.update = result
      status.textContent = result.hasUpdate
        ? `有新版本 ${result.latest}（当前 ${result.current}）`
        : `已是最新（${result.current}）`
      return
    }

    const release = `https://github.com/${SOURCE.owner}/${SOURCE.repo}/releases/latest/download`
    const text = await nativeGetText(`${SOURCE.mirror}${release}/latest.yml`)
    const latest = /^version:\s*(.+)$/m.exec(text)?.[1]?.trim()
    const hasUpdate = latest && latest !== state.version
    state.update = {
      latest,
      hasUpdate,
      apkUrl: `${SOURCE.mirror}${release}/DSH-App-${latest}-release.apk`,
    }
    status.textContent = hasUpdate ? `有新版本 ${latest}（当前 ${state.version}）` : `已是最新（${state.version}）`
  } catch (error) {
    status.textContent = `检查失败：${error.message}`
  }
}

async function installUpdate() {
  const status = $('#update-status')
  if (!state.update?.hasUpdate) return
  if (state.env === 'desktop') {
    status.textContent = '下载中…'
    try {
      const result = await window.bridge.downloadUpdate({
        url: state.update.downloadUrl,
        sha512: state.update.sha512,
        file: state.update.file,
      })
      status.textContent = '下载完成，正在安装…'
      await window.bridge.installUpdate(result.path)
    } catch (error) {
      status.textContent = `下载失败：${error.message}`
    }
    return
  }
  window.open(state.update.apkUrl, '_blank')
  status.textContent = '已交给浏览器下载'
}

/* ---------------- 设置 ---------------- */

function segmentedRow(label, options, current, onPick) {
  const row = el('div', 'setting-row')
  row.appendChild(el('span', 'setting-label', label))
  const seg = el('div', `segmented compact seg-${options.length}`)
  for (const [value, text] of options) {
    const button = el('button', `seg${value === current ? ' active' : ''}`, text)
    button.type = 'button'
    button.addEventListener('click', () => onPick(value, seg, button))
    seg.appendChild(button)
  }
  row.appendChild(seg)
  return row
}

function appearanceCard() {
  const card = el('section', 'card')
  card.appendChild(el('div', 'field-label', '外观'))

  card.appendChild(
    segmentedRow(
      '字体大小',
      [
        ['small', '小'],
        ['normal', '标准'],
        ['large', '大'],
        ['xlarge', '特大'],
      ],
      state.settings.fontSize || 'normal',
      async (value, seg, button) => {
        state.settings.fontSize = value
        await store.saveSetting('fontSize', value)
        applyAppearance()
        for (const node of seg.children) node.classList.toggle('active', node === button)
      },
    ),
  )

  card.appendChild(
    segmentedRow(
      '字体粗细',
      [
        ['normal', '常规'],
        ['bold', '加粗'],
      ],
      state.settings.fontWeight || 'normal',
      async (value, seg, button) => {
        state.settings.fontWeight = value
        await store.saveSetting('fontWeight', value)
        applyAppearance()
        for (const node of seg.children) node.classList.toggle('active', node === button)
      },
    ),
  )

  card.appendChild(el('div', 'field-label', '任务块颜色'))
  for (const type of TASK_TYPES) {
    const row = el('label', 'type-color-row')
    row.appendChild(el('span', 'setting-label', TYPE_LABEL[type]))
    const input = document.createElement('input')
    input.type = 'color'
    input.value = normalizeHex(state.settings.typeColors?.[type], TYPE_COLOR_FALLBACK[type])
    input.addEventListener('change', async () => {
      state.settings.typeColors = { ...(state.settings.typeColors || {}), [type]: input.value }
      await store.saveSetting('typeColors', state.settings.typeColors)
      applyAppearance()
    })
    row.appendChild(input)
    card.appendChild(row)
  }
  card.appendChild(el('div', 'muted', '颜色用在任务块标题和任务卡片左侧的色条上。'))
  return card
}

function soundCard() {
  const card = el('section', 'card')
  card.appendChild(el('div', 'field-label', '提醒音乐'))
  const status = el(
    'div',
    'muted',
    state.settings.alarmSoundName ? `当前：${state.settings.alarmSoundName}` : '当前：系统默认闹铃',
  )
  card.appendChild(status)
  card.appendChild(el('div', 'muted', '强提醒到点后会循环播放，点「停止提醒」才停。'))

  const file = document.createElement('input')
  file.type = 'file'
  file.accept = 'audio/*'
  file.hidden = true
  card.appendChild(file)

  const actions = el('div', 'actions')
  const choose = el('button', 'primary', '选择音频')
  choose.type = 'button'
  choose.addEventListener('click', () => file.click())

  const reset = el('button', 'ghost', '恢复默认')
  reset.type = 'button'
  reset.disabled = !state.settings.alarmSoundName
  reset.addEventListener('click', async () => {
    await native.clearAlarmSound()
    state.settings.alarmSoundName = ''
    await store.saveSetting('alarmSoundName', '')
    await render()
  })
  actions.append(choose, reset)
  card.appendChild(actions)

  file.addEventListener('change', async () => {
    const picked = file.files?.[0]
    file.value = ''
    if (!picked) return
    if (picked.size > 8 * 1024 * 1024) {
      window.alert('音频太大了（限 8 MB），换一首小一点的吧')
      return
    }
    choose.disabled = true
    status.textContent = '保存中…'
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(picked)
      })
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
      const result = await native.saveAlarmSound({ data: base64, name: picked.name })
      if (!result?.ok) throw new Error('原生侧没有保存成功')
      state.settings.alarmSoundName = picked.name
      await store.saveSetting('alarmSoundName', picked.name)
      await render()
    } catch (error) {
      status.textContent = `保存失败：${error.message}`
      choose.disabled = false
    }
  })

  return card
}

function renderSettings() {
  const view = $('#view')
  view.replaceChildren()
  $('#today-summary').textContent = '设置'

  view.appendChild(appearanceCard())
  view.appendChild(backgroundCard())

  // 主题（皮肤）选择：皮肤注册表在 www/themes.js，运行时可用 window.LYTheme 扩展
  const themeCard = el('section', 'card')
  themeCard.appendChild(el('div', 'field-label', '主题'))
  const themeList = el('div', 'theme-list')
  const activeTheme = currentTheme().id
  for (const theme of listThemes()) {
    const option = el('button', `theme-option${theme.id === activeTheme ? ' active' : ''}`, theme.name)
    option.type = 'button'
    option.addEventListener('click', () => {
      applyTheme(theme.id)
      for (const node of themeList.children) node.classList.toggle('active', node === option)
    })
    themeList.appendChild(option)
  }
  themeCard.appendChild(themeList)
  view.appendChild(themeCard)

  const timeCard = el('section', 'card')
  const timeRow = el('label', 'field row')
  timeRow.append(el('span', '', '晚间总结时间'))
  const timeInput = document.createElement('input')
  timeInput.type = 'time'
  timeInput.value = state.settings.summaryTime
  timeInput.addEventListener('change', async () => {
    await store.saveSetting('summaryTime', timeInput.value)
    state.settings.summaryTime = timeInput.value
    await refreshNotifications()
  })
  timeRow.appendChild(timeInput)
  timeCard.appendChild(timeRow)

  // 截止提前量：全局默认，任务里可以单独覆盖
  const leadRow = el('label', 'field row')
  leadRow.append(el('span', '', '截止提前提醒（分钟）'))
  const leadInput = document.createElement('input')
  leadInput.type = 'number'
  leadInput.min = '1'
  leadInput.max = '10080'
  leadInput.inputMode = 'numeric'
  leadInput.value = String(state.settings.leadMinutes ?? 15)
  leadInput.addEventListener('change', async () => {
    const value = Number(leadInput.value)
    const next = Number.isFinite(value) && value > 0 ? Math.round(value) : 15
    leadInput.value = String(next)
    state.settings.leadMinutes = next
    await store.saveSetting('leadMinutes', next)
    await refreshNotifications()
  })
  leadRow.appendChild(leadInput)
  timeCard.appendChild(leadRow)
  timeCard.appendChild(el('div', 'muted', '任务里填了「提前提醒」就以任务为准，留空则用这里。'))

  timeCard.appendChild(el('div', 'field-label', '倒计时颜色'))
  const legend = el('div', 'legend')
  for (const [level, text] of [
    ['calm', '> 48 小时'],
    ['green', '48–12 小时'],
    ['yellow', '12–4 小时'],
    ['orange', '4–1 小时'],
    ['red', '< 1 小时'],
  ]) legend.appendChild(el('span', `chip chip-${level}`, text))
  timeCard.appendChild(legend)
  view.appendChild(timeCard)

  // 健身：轮换基准 + 整块提醒（最多 3 个时间点）
  const fitnessCard = el('section', 'card')
  fitnessCard.appendChild(el('div', 'field-label', '健身'))
  const anchorLine = el(
    'div',
    'muted',
    `轮换基准 ${state.settings.fitnessAnchor || '未设置'} · 今天应是${DAY_LABEL[rotationFor(state.settings.fitnessAnchor, state.date)]}`,
  )
  fitnessCard.appendChild(anchorLine)
  const resetAnchor = el('button', 'ghost', '把今天设为力量日基准')
  resetAnchor.type = 'button'
  resetAnchor.addEventListener('click', async () => {
    state.settings.fitnessAnchor = state.date
    state.settings.fitnessOverride = null
    await store.saveSetting('fitnessAnchor', state.date)
    await store.saveSetting('fitnessOverride', null)
    await render()
    await refreshNotifications()
  })
  fitnessCard.appendChild(resetAnchor)

  fitnessCard.appendChild(el('div', 'field-label', '健身提醒（整块，最多 3 个）'))
  const rows = []
  const existing = [...(state.settings.fitnessReminders || [])]
  for (let index = 0; index < 3; index += 1) {
    const reminder = existing[index] || { time: '', repeat: 'daily', date: '' }
    const row = el('div', 'reminder-row')
    const time = document.createElement('input')
    time.type = 'time'
    time.value = reminder.time || ''
    const repeat = document.createElement('select')
    for (const [value, label] of [
      ['daily', '每天'],
      ['once', '一次性'],
    ]) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      if (reminder.repeat === value) option.selected = true
      repeat.appendChild(option)
    }
    const date = document.createElement('input')
    date.type = 'date'
    date.value = reminder.date || ''
    date.hidden = reminder.repeat !== 'once'
    repeat.addEventListener('change', () => {
      date.hidden = repeat.value !== 'once'
    })
    row.append(time, repeat, date)
    rows.push({ time, repeat, date })
    fitnessCard.appendChild(row)
  }
  const saveFitness = el('button', 'primary', '保存健身提醒')
  saveFitness.type = 'button'
  saveFitness.addEventListener('click', async () => {
    const next = []
    for (const row of rows) {
      if (!row.time.value) continue
      next.push({
        time: row.time.value,
        repeat: row.repeat.value,
        date: row.repeat.value === 'once' ? row.date.value : '',
      })
    }
    state.settings.fitnessReminders = next.slice(0, 3)
    await store.saveSetting('fitnessReminders', state.settings.fitnessReminders)
    await refreshNotifications()
    saveFitness.textContent = '已保存'
    setTimeout(() => {
      saveFitness.textContent = '保存健身提醒'
    }, 1500)
  })
  fitnessCard.appendChild(saveFitness)
  view.appendChild(fitnessCard)

  // 通知与权限（仅安卓 App 显示）
  if (native.isNative()) {
    const notifyCard = el('section', 'card')
    notifyCard.appendChild(el('div', 'field-label', '通知与提醒'))
    const statusLine = el('div', 'muted', '点「检查权限」查看当前状态')
    notifyCard.appendChild(statusLine)

    const row = el('div', 'actions')
    const checkBtn = el('button', 'ghost', '检查权限')
    checkBtn.type = 'button'
    checkBtn.addEventListener('click', async () => {
      const result = await native.status()
      if (!result) {
        statusLine.textContent = '读不到权限状态'
        return
      }
      statusLine.textContent = `通知 ${result.notifications ? '✓' : '✗'} · 精确闹钟 ${
        result.exactAlarm ? '✓' : '✗'
      } · 电池优化 ${result.batteryOptimized ? '未关闭' : '已关闭'}`
    })

    const requestBtn = el('button', 'primary', '申请权限')
    requestBtn.type = 'button'
    requestBtn.addEventListener('click', async () => {
      await native.requestPermissions()
      statusLine.textContent = '已发起申请，请按系统提示操作'
    })

    row.append(checkBtn, requestBtn)
    notifyCard.appendChild(row)

    const batteryBtn = el('button', 'ghost', '电池优化设置（保活）')
    batteryBtn.type = 'button'
    batteryBtn.addEventListener('click', () => native.openBatterySettings())
    notifyCard.appendChild(batteryBtn)
    notifyCard.appendChild(
      el('div', 'muted', '荣耀/华为还需在「应用启动管理」里允许自启动，否则提醒可能被系统延迟。'),
    )
    view.appendChild(notifyCard)

    view.appendChild(soundCard())

    // 桌面小组件的外观（仅安卓）：颜色 + 不透明度，跟着 syncState 一起下发给原生
    const widgetCard = el('section', 'card')
    widgetCard.appendChild(el('div', 'field-label', '桌面小组件'))

    const preview = el('div', 'widget-preview')
    preview.style.background = normalizeHex(state.settings.widgetColor)
    preview.style.opacity = String(widgetOpacityValue())
    preview.appendChild(el('span', 'widget-preview-text', '今日任务 · 3/7'))
    widgetCard.appendChild(preview)

    const colorRow = el('label', 'field row')
    colorRow.append(el('span', '', '背景颜色'))
    const colorInput = document.createElement('input')
    colorInput.type = 'color'
    colorInput.value = normalizeHex(state.settings.widgetColor)
    colorInput.addEventListener('input', () => {
      preview.style.background = colorInput.value
    })
    colorInput.addEventListener('change', async () => {
      state.settings.widgetColor = colorInput.value
      await store.saveSetting('widgetColor', colorInput.value)
      await refreshNotifications()
    })
    colorRow.appendChild(colorInput)
    widgetCard.appendChild(colorRow)

    widgetCard.appendChild(
      sliderRow({
        label: '不透明度',
        value: Math.round(widgetOpacityValue() * 100),
        min: 0,
        max: 100,
        step: 1,
        onInput: (value) => {
          preview.style.opacity = String(value / 100)
        },
        onChange: async (value) => {
          state.settings.widgetOpacity = value / 100
          await store.saveSetting('widgetOpacity', value / 100)
          await refreshNotifications()
        },
      }),
    )
    widgetCard.appendChild(el('div', 'muted', '组件是纯色块渲染，所以边角会变成直角。'))
    view.appendChild(widgetCard)
  }

  const updateCard = el('section', 'card')
  updateCard.appendChild(el('div', 'field-label', `版本 ${state.version}`))
  const updateStatus = el('div', 'muted', '尚未检查')
  updateStatus.id = 'update-status'
  updateCard.appendChild(updateStatus)

  const updateActions = el('div', 'actions')
  const checkBtn = el('button', 'primary', '检查更新')
  checkBtn.type = 'button'
  checkBtn.addEventListener('click', checkUpdate)
  const installBtn = el('button', 'ghost', '下载并安装')
  installBtn.type = 'button'
  installBtn.addEventListener('click', installUpdate)
  updateActions.append(checkBtn, installBtn)
  updateCard.appendChild(updateActions)
  view.appendChild(updateCard)

  const backupCard = el('section', 'card')
  backupCard.appendChild(el('div', 'field-label', '备份'))
  const exportBtn = el('button', 'primary', '导出备份')
  exportBtn.type = 'button'
  exportBtn.addEventListener('click', async () => {
    const payload = await store.exportAll()
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lyapp-backup-${dateKey()}.json`
    a.click()
    URL.revokeObjectURL(url)
  })
  backupCard.appendChild(exportBtn)

  const importFile = document.createElement('input')
  importFile.type = 'file'
  importFile.accept = 'application/json,.json'
  importFile.hidden = true
  backupCard.appendChild(importFile)

  const importBtn = el('button', 'ghost', '导入备份')
  importBtn.type = 'button'
  importBtn.addEventListener('click', () => importFile.click())
  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0]
    importFile.value = ''
    if (!file) return
    try {
      const payload = JSON.parse(await file.text())
      const summary = summarizeBackup(payload)
      const ok = window.confirm(`导入会用备份覆盖当前数据：\n${summary}\n\n继续？`)
      if (!ok) return
      await store.importAll(payload)
      await reload()
      await render()
      await refreshNotifications()
      window.alert('导入完成')
    } catch (error) {
      window.alert(`导入失败：${error.message}`)
    }
  })
  backupCard.appendChild(importBtn)
  backupCard.appendChild(el('div', 'muted', '导入会清空现有数据再写入，背景图也会一起恢复。'))
  view.appendChild(backupCard)
}

/** 备份文件里有什么，导入前让人一眼看清。 */
function summarizeBackup(payload) {
  const data = payload?.data || payload || {}
  const labels = {
    tasks: '任务',
    fitness: '健身项',
    occurrences: '完成记录',
    cards: '记录卡',
    journal: '每日总结',
    sessions: '时间片段',
    settings: '设置项',
  }
  const parts = Object.entries(labels)
    .filter(([key]) => Array.isArray(data[key]))
    .map(([key, label]) => `${label} ${data[key].length} 条`)
  return parts.length ? parts.join('、') : '（没有识别到可导入的数据）'
}

/* ---------------- 框架 ---------------- */

function updateTopbar() {
  const weekday = WEEK_LABEL[weekdayOf(state.date)] || ''
  $('#today-date').textContent = `${state.date} ${weekday}`
  const busyBtn = $('#busy-toggle')
  const busy = Boolean(state.settings?.busy)
  busyBtn.textContent = busy ? '繁忙中' : '空闲'
  busyBtn.classList.toggle('busy', busy)
  $('#add-task').setAttribute('aria-label', state.tab === 'fitness' ? '新建健身项' : '新建任务')
}

async function render() {
  updateTopbar()
  if (state.tab === 'today') renderToday()
  else if (state.tab === 'fitness') renderFitness()
  else if (state.tab === 'calendar') await renderCalendar()
  else if (state.tab === 'records') await renderRecords()
  else if (state.tab === 'stats') await renderStats()
  else renderSettings()
}

/** 同步事件里调用：不关心结果，但别留下未处理的 rejection。 */
function rerender() {
  render().catch((error) => console.warn('[render]', error))
}

/**
 * 切繁忙 / 空闲，并记账。
 * atMs 用来支持“在通知栏上点的按钮”：那时的时刻才是真正的切换点，
 * 哪怕几分钟后才打开 App，工作时段也能按真实时间落库。
 */
/**
 * 只改“繁忙状态 + 工作时段”，不重绘 —— 批量补账时用。
 * atMs 用来支持“在通知栏上点的按钮”：那时的时刻才是真正的切换点，
 * 哪怕几分钟后 / 几天后才打开 App，工作时段也能按真实时间落库。
 */
async function writeBusyState(busy, atMs = Date.now()) {
  state.settings.busy = busy
  await store.saveSetting('busy', busy)

  const sessions = await store.getAll('sessions')
  const open = sessions.filter((s) => s.kind === 'busy' && !s.end).sort((a, b) => b.start.localeCompare(a.start))[0]
  if (busy) {
    await store.put('sessions', { id: crypto.randomUUID(), kind: 'busy', start: new Date(atMs).toISOString(), end: null })
  } else if (open) {
    // 结束时间不能早于开始时间（系统时钟回拨 / 通知点的顺序错乱时兜一下）
    const startMs = new Date(open.start).getTime()
    const endMs = Math.max(atMs, Number.isFinite(startMs) ? startMs + 1000 : atMs)
    await store.put('sessions', { ...open, end: new Date(endMs).toISOString() })
  }
}

async function applyBusy(busy, atMs = Date.now()) {
  await writeBusyState(busy, atMs)
  await render()
  await refreshNotifications()
}

async function toggleBusy() {
  await applyBusy(!Boolean(state.settings.busy))
}

/**
 * 把通知栏上的点击按顺序补记回来。
 * 可能攒了好几次（比如“繁忙 → 空闲”都没打开 App），所以要逐条回放，
 * 每条的切换时刻都用原生记下的那个时间。
 */
async function syncBusyFromNotification() {
  const pending = await native.consumeBusyToggle()
  if (!Array.isArray(pending) || pending.length === 0) return

  let changed = false
  for (const item of pending) {
    if (Boolean(state.settings?.busy) === item.busy) continue
    await writeBusyState(item.busy, item.at)
    changed = true
  }
  if (!changed) return

  await render()
  await refreshNotifications()
}

async function detectVersion() {
  try {
    if (window.bridge?.info) {
      const info = await window.bridge.info()
      state.env = 'desktop'
      state.version = info.version
      return
    }
    if (window.Capacitor?.isNativePlatform?.()) state.env = 'android'
    const res = await fetch('./app-version.json', { cache: 'no-store' })
    if (res.ok) state.version = (await res.json()).version
  } catch {
    /* 版本读不到不影响使用 */
  }
}

async function ensureFitnessAnchor() {
  if (state.settings.fitnessAnchor) return
  state.settings.fitnessAnchor = state.date
  await store.saveSetting('fitnessAnchor', state.date)
}

/** 系统日期翻天后自动跟上（App 常驻后台时不至于一直停在前一天）。 */
async function handleDateRollover() {
  const today = dateKey()
  if (today === state.date) return
  state.date = today
  state.calendarDate = today
  state.month = monthOf(today)
  await reload()
  await render()
  await refreshNotifications()
}

async function boot() {
  applyTheme(currentTheme().id, { persist: false })
  await detectVersion()
  await reload()

  const migrated = await store.migrateFitnessTasks()
  if (migrated) await reload()
  await ensureFitnessAnchor()
  applyAppearance()
  await loadBackground()
  // 上次在通知栏上点的「繁忙/空闲」可能还没记账
  await syncBusyFromNotification()
  await render()
  await refreshNotifications()

  // 到点且今天还没写总结 → 自动弹出
  if (summaryDue()) {
    const entry = await store.getOne('journal', state.date)
    if (!entry) await openSummary(state.date)
  }

  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.tab = tab.dataset.tab
      $$('.tab').forEach((t) => t.classList.toggle('active', t === tab))
      rerender()
    })
  })

  $('#add-task').addEventListener('click', () => {
    if (state.tab === 'fitness') openFitnessEditor(null, dayKind(state.settings, state.date))
    else if (state.tab === 'calendar') openEditor(null, state.calendarDate)
    else openEditor(null, state.date)
  })
  $('#busy-toggle').addEventListener('click', toggleBusy)

  $('#cancel-task').addEventListener('click', () => $('#task-dialog').close())
  $('#repeat-kind').addEventListener('change', syncRepeatFields)
  $('#task-type').addEventListener('change', syncTypeFields)

  $('#cancel-fitness').addEventListener('click', () => $('#fitness-dialog').close())
  $('#fitness-day').addEventListener('change', syncFitnessFields)
  $('#fitness-repeat-kind').addEventListener('change', syncFitnessFields)

  $('#summary-later').addEventListener('click', () => $('#summary-dialog').close())
  $('#summary-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = $('#summary-form')
    await store.put('journal', {
      date: state.summaryDate,
      summary: form.elements.summary.value.trim(),
      planFree: form.elements.plan.value.trim(),
      planTaskIds: [],
    })
    $('#summary-dialog').close()
    if (state.tab === 'records') await render()
  })

  $('#card-cancel').addEventListener('click', () => $('#card-dialog').close())
  $('#card-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = $('#card-form')
    const body = form.elements.body.value.trim()
    if (!body) return
    const editing = state.editingCard
    await store.put('cards', {
      id: editing?.id || crypto.randomUUID(),
      createdAt: editing?.createdAt || new Date().toISOString(),
      updatedAt: editing ? new Date().toISOString() : undefined,
      title: form.elements.title.value.trim(),
      body,
      tags: form.elements.tags.value
        .split(/[,，\s]+/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    })
    state.editingCard = null
    $('#card-dialog').close()
    if (state.tab === 'records') await render()
  })

  $('#task-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const data = readForm()
    if (!data.title) return
    const task = state.editing
      ? { ...state.editing, ...data }
      : { ...data, id: crypto.randomUUID(), createdAt: new Date().toISOString(), order: nextOrderFor(data.type) }
    await store.saveTask(task)
    $('#task-dialog').close()
    await reload()
    await render()
    await refreshNotifications()
  })

  $('#fitness-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const data = readFitnessForm()
    if (!data.name) return
    const item = state.editingFitness
      ? { ...state.editingFitness, ...data }
      : { ...data, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
    await store.saveFitnessItem(item)
    $('#fitness-dialog').close()
    await reload()
    await render()
    await refreshNotifications()
  })

  setInterval(() => {
    handleDateRollover().catch(() => {})
    syncBusyFromNotification().catch(() => {})
    if (state.tab === 'today') updateTopbar()
  }, 30000)

  // 从桌面小组件 / 通知栏回来时，先把原生侧那次点击补记上
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncBusyFromNotification().catch(() => {})
  })

  // 清理 0.1.x 遗留的 PWA service worker：
  // 它会把旧版的 index.html/style.css/app.js 缓存下来，
  // 升级后就会出现「新界面 + 旧脚本」→ 按钮全部失灵。原生 App 不需要 SW。
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .getRegistrations?.()
      .then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
      .catch(() => {})
  }
  if (window.caches && typeof caches.keys === 'function') {
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .catch(() => {})
  }
}

boot().catch((error) => {
  document.body.innerHTML = `<pre class="fatal">启动失败：${error.message}</pre>`
})
