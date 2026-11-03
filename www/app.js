import { dateKey, projectDay, countdown, fitnessSummary } from './model.js'
import * as store from './store.js'
import * as native from './native.js'
import { apply as applyTheme, current as currentTheme, list as listThemes } from './themes.js'

const SOURCE = { owner: 'ROCE1', repo: '-', mirror: 'https://gh-proxy.com/' }

const state = {
  tab: 'today',
  date: dateKey(),
  tasks: [],
  done: {},
  settings: null,
  editing: null,
  env: 'web',
  version: '—',
  update: null,
}

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))

const TYPE_LABEL = { urgent: '紧急', main: '主线', side: '支线', fitness: '健身' }
const TYPE_ORDER = ['urgent', 'main', 'side', 'fitness']

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

async function reload() {
  state.tasks = await store.listTasks()
  state.done = await store.doneMapFor(state.date)
  state.settings = await store.loadSettings()
}

/* ---------------- 原生通知与闹钟 ---------------- */

const LEAD_MINUTES = 15

function panelLines(groups) {
  const lines = []
  for (const type of ['urgent', 'main', 'side']) {
    for (const entry of groups[type]) {
      if (entry.done) continue
      const info = entry.task.deadline
        ? countdown(entry.task.deadline, new Date(), state.settings?.countdownThresholds)
        : null
      lines.push(`${TYPE_LABEL[type]} ${entry.task.title}${info ? ` · ${info.label}` : ''}`)
      if (lines.length >= 3) return lines
    }
  }
  return lines
}

/**
 * 把“今天该显示什么、该在什么时间提醒”同步给原生层。
 * 每次任务/状态变化都重排一次：先清空旧闹钟再注册，避免删掉的任务还在响。
 */
async function refreshNotifications() {
  if (!native.isNative()) return
  const groups = projectDay(state.tasks, state.done, state.date)
  const busy = Boolean(state.settings?.busy)
  const lines = panelLines(groups)

  await native.syncState({
    title: busy ? '繁忙中 · 今日任务' : '空闲 · 今日任务',
    text: lines.length ? lines.join('\n') : '今天还没有任务',
    busy,
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
      title: '健身时间',
      body: '该动一动了（繁忙时会跳过）',
      strong: false,
    })
  }

  for (const type of ['urgent', 'main', 'side']) {
    for (const entry of groups[type]) {
      if (entry.done || !entry.task.deadline) continue
      const due = new Date(entry.task.deadline).getTime()
      if (Number.isNaN(due)) continue
      const lead = due - LEAD_MINUTES * 60000
      const strong = Boolean(entry.task.strong)
      if (lead > nowMs) {
        await native.schedule({
          id: `${entry.task.id}:lead`,
          at: lead,
          title: entry.task.title,
          body: `还有 ${LEAD_MINUTES} 分钟到期`,
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

/* ---------------- 今日 ---------------- */

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

function taskRow(entry) {
  const { task, done } = entry
  const wrap = el('div', 'task-wrap')

  const remove = el('button', 'task-delete', '删除')
  remove.type = 'button'
  remove.addEventListener('click', async (event) => {
    event.stopPropagation()
    await store.deleteTask(task.id)
    await reload()
    render()
    await refreshNotifications()
  })

  const row = el('div', `task${done ? ' done' : ''}`)

  const checkbox = el('button', 'check')
  checkbox.type = 'button'
  checkbox.setAttribute('aria-label', done ? '取消完成' : '标记完成')
  checkbox.textContent = done ? '✓' : ''
  checkbox.addEventListener('click', async (event) => {
    event.stopPropagation()
    await store.setDone(task.id, state.date, !done)
    await reload()
    render()
    await refreshNotifications()
  })

  const body = el('div', 'task-body')
  body.appendChild(el('div', 'task-title', task.title))

  const meta = el('div', 'task-meta')
  if (task.strong) meta.appendChild(el('span', 'badge strong', '强'))
  const chip = chipFor(task)
  if (chip) meta.appendChild(chip)
  if (meta.children.length) body.appendChild(meta)

  row.append(checkbox, body)
  row.addEventListener('click', () => openEditor(task))
  attachSwipe(row)

  wrap.append(remove, row)
  return wrap
}

function section(type, entries) {
  const wrap = el('section', `group group-${type}`)
  const head = el('div', 'group-head')
  head.append(el('span', 'group-title', TYPE_LABEL[type]), el('span', 'group-count', String(entries.length)))
  wrap.appendChild(head)
  if (entries.length === 0) wrap.appendChild(el('div', 'empty', '今天没有'))
  else for (const entry of entries) wrap.appendChild(taskRow(entry))
  return wrap
}

function renderToday() {
  const groups = projectDay(state.tasks, state.done, state.date)
  const view = $('#view')
  view.replaceChildren()

  for (const type of TYPE_ORDER) {
    if (type === 'fitness' && groups.fitness.length === 0) continue
    view.appendChild(section(type, groups[type]))
  }

  const total = Object.values(groups).reduce((sum, list) => sum + list.length, 0)
  const doneCount = Object.values(groups).reduce((sum, list) => sum + list.filter((i) => i.done).length, 0)
  $('#today-summary').textContent = total === 0 ? '今天还没有任务' : `已完成 ${doneCount} / ${total}`
}

/* ---------------- 编辑器 ---------------- */

function syncRepeatFields() {
  const kind = $('#repeat-kind').value
  for (const field of $$('[data-repeat]')) field.hidden = field.dataset.repeat !== kind
}

function fillForm(task) {
  const form = $('#task-form')
  form.reset()
  $('#dialog-title').textContent = task ? '编辑任务' : '新建任务'
  form.elements.onceDate.value = state.date
  syncRepeatFields()
  if (!task) return

  form.elements.title.value = task.title
  form.elements.type.value = task.type
  form.elements.repeatKind.value = task.repeat.kind
  form.elements.deadline.value = task.deadline ? task.deadline.slice(0, 16) : ''
  form.elements.strong.checked = Boolean(task.strong)
  form.elements.notes.value = task.notes || ''
  if (task.repeat.kind === 'once') form.elements.onceDate.value = task.repeat.date
  if (task.repeat.kind === 'everyN') form.elements.everyN.value = task.repeat.n
  if (task.repeat.kind === 'weekly') {
    for (const option of form.elements.weeklyDays.options) {
      option.selected = task.repeat.days.includes(Number(option.value))
    }
  }
  syncRepeatFields()
}

function openEditor(task) {
  state.editing = task || null
  fillForm(task)
  $('#task-dialog').showModal()
}

function readForm() {
  const form = $('#task-form')
  const kind = form.elements.repeatKind.value
  let repeat
  if (kind === 'once') repeat = { kind, date: form.elements.onceDate.value || state.date }
  else if (kind === 'weekly') {
    const days = Array.from(form.elements.weeklyDays.selectedOptions).map((o) => Number(o.value))
    repeat = { kind, days: days.length ? days : [new Date().getDay()] }
  } else if (kind === 'everyN') {
    repeat = { kind, n: Number(form.elements.everyN.value) || 1, anchor: state.date }
  } else repeat = { kind: 'daily' }

  const deadlineValue = form.elements.deadline.value
  return {
    title: form.elements.title.value.trim(),
    type: form.elements.type.value,
    repeat,
    deadline: deadlineValue ? new Date(deadlineValue).toISOString() : null,
    strong: form.elements.strong.checked,
    notes: form.elements.notes.value.trim(),
  }
}

/* ---------------- 更新（保留原有能力） ---------------- */

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

/* ---------------- 其它页 ---------------- */

async function renderRecords() {
  const view = $('#view')
  view.replaceChildren()
  const cards = (await store.getAll('cards')).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))

  const head = el('div', 'field-label', `记录卡 · ${cards.length}`)
  view.appendChild(head)

  if (cards.length === 0) view.appendChild(el('div', 'placeholder', '还没有记录卡。它和每日日志不同：随时写、可多条。'))

  for (const card of cards) {
    const item = el('section', 'card')
    const top = el('div', 'card-head')
    top.appendChild(el('div', 'card-title', card.title || '未命名'))
    const del = el('button', 'link-danger', '删除')
    del.type = 'button'
    del.addEventListener('click', async () => {
      await store.remove('cards', card.id)
      await renderRecords()
    })
    top.appendChild(del)
    item.appendChild(top)
    const when = new Date(card.createdAt).toLocaleString('zh-CN')
    item.appendChild(el('div', 'muted', when))
    item.appendChild(el('div', 'card-body', card.body))
    if (card.tags?.length) item.appendChild(el('div', 'muted', card.tags.map((tag) => `#${tag}`).join(' ')))
    view.appendChild(item)
  }

  const add = el('button', 'primary', '写一张记录卡')
  add.type = 'button'
  add.addEventListener('click', () => {
    $('#card-form').reset()
    $('#card-dialog').showModal()
  })
  view.appendChild(add)
}

/* ---------------- 每日总结 ---------------- */

function summaryDue() {
  const [hour, minute] = String(state.settings?.summaryTime || '22:00').split(':').map(Number)
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes() >= hour * 60 + minute
}

async function openSummary() {
  const groups = projectDay(state.tasks, state.done, state.date)
  const doneList = []
  for (const type of TYPE_ORDER) {
    for (const entry of groups[type]) if (entry.done) doneList.push(entry.task.title)
  }
  $('#summary-title').textContent = `${state.date} 总结`
  $('#summary-done').textContent = doneList.length ? `已完成 ${doneList.length} 项：${doneList.join('、')}` : '今天没有完成任何任务'

  const existing = await store.getOne('journal', state.date)
  const form = $('#summary-form')
  form.elements.summary.value = existing?.summary || ''
  form.elements.plan.value = existing?.planFree || ''
  $('#summary-dialog').showModal()
}

function renderCalendar() {
  $('#view').replaceChildren(el('div', 'placeholder', '月历视图将在后续版本实现'))
}

function renderSettings() {
  const view = $('#view')
  view.replaceChildren()

  const card = el('section', 'card')
  const timeRow = el('label', 'field row')
  timeRow.append(el('span', '', '晚间总结时间'))
  const timeInput = document.createElement('input')
  timeInput.type = 'time'
  timeInput.value = state.settings.summaryTime
  timeInput.addEventListener('change', async () => {
    await store.saveSetting('summaryTime', timeInput.value)
    state.settings.summaryTime = timeInput.value
  })
  timeRow.appendChild(timeInput)
  card.appendChild(timeRow)

  card.appendChild(el('div', 'field-label', '倒计时颜色'))
  const legend = el('div', 'legend')
  for (const [level, text] of [
    ['calm', '> 48 小时'],
    ['green', '48–12 小时'],
    ['yellow', '12–4 小时'],
    ['orange', '4–1 小时'],
    ['red', '< 1 小时'],
  ]) legend.appendChild(el('span', `chip chip-${level}`, text))
  card.appendChild(legend)

  view.appendChild(card)

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
  }

  // 健身提醒：整块提醒，最多 3 个时间点，每个可选每天/一次性
  const fitnessCard = el('section', 'card')
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
    for (const [value, label] of [['daily', '每天'], ['once', '一次性']]) {
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

  const updateCard = el('section', 'card')
  updateCard.appendChild(el('div', 'field-label', `版本 ${state.version}`))
  const statusLine = el('div', 'muted', '尚未检查')
  statusLine.id = 'update-status'
  updateCard.appendChild(statusLine)

  const actions = el('div', 'actions')
  const checkBtn = el('button', 'primary', '检查更新')
  checkBtn.type = 'button'
  checkBtn.addEventListener('click', checkUpdate)
  const installBtn = el('button', 'ghost', '下载并安装')
  installBtn.type = 'button'
  installBtn.addEventListener('click', installUpdate)
  actions.append(checkBtn, installBtn)
  updateCard.appendChild(actions)
  view.appendChild(updateCard)

  const backupCard = el('section', 'card')
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
  view.appendChild(backupCard)
}

/* ---------------- 框架 ---------------- */

function render() {
  $('#today-date').textContent = state.date
  const busyBtn = $('#busy-toggle')
  const busy = Boolean(state.settings?.busy)
  busyBtn.textContent = busy ? '繁忙中' : '空闲'
  busyBtn.classList.toggle('busy', busy)

  if (state.tab === 'today') renderToday()
  else if (state.tab === 'calendar') renderCalendar()
  else if (state.tab === 'records') renderRecords()
  else renderSettings()
}

async function toggleBusy() {
  const busy = !state.settings.busy
  state.settings.busy = busy
  await store.saveSetting('busy', busy)

  const sessions = await store.getAll('sessions')
  const open = sessions.filter((s) => s.kind === 'busy' && !s.end).sort((a, b) => b.start.localeCompare(a.start))[0]
  if (busy) {
    await store.put('sessions', { id: crypto.randomUUID(), kind: 'busy', start: new Date().toISOString(), end: null })
  } else if (open) {
    await store.put('sessions', { ...open, end: new Date().toISOString() })
  }
  render()
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

async function boot() {
  applyTheme(currentTheme().id, { persist: false })
  await detectVersion()
  await reload()
  render()
  await refreshNotifications()

  // 到点且今天还没写总结 → 自动弹出
  if (summaryDue()) {
    const entry = await store.getOne('journal', state.date)
    if (!entry) await openSummary()
  }

  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.tab = tab.dataset.tab
      $$('.tab').forEach((t) => t.classList.toggle('active', t === tab))
      render()
    })
  })

  $('#add-task').addEventListener('click', () => openEditor(null))
  $('#busy-toggle').addEventListener('click', toggleBusy)
  $('#cancel-task').addEventListener('click', () => $('#task-dialog').close())
  $('#repeat-kind').addEventListener('change', syncRepeatFields)

  $('#summary-later').addEventListener('click', () => $('#summary-dialog').close())
  $('#summary-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = $('#summary-form')
    await store.put('journal', {
      date: state.date,
      summary: form.elements.summary.value.trim(),
      planFree: form.elements.plan.value.trim(),
      planTaskIds: [],
    })
    $('#summary-dialog').close()
  })

  $('#card-cancel').addEventListener('click', () => $('#card-dialog').close())
  $('#card-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = $('#card-form')
    const body = form.elements.body.value.trim()
    if (!body) return
    await store.put('cards', {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      title: form.elements.title.value.trim(),
      body,
      tags: form.elements.tags.value
        .split(/[,，\s]+/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    })
    $('#card-dialog').close()
    if (state.tab === 'records') await renderRecords()
  })

  $('#task-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = $('#task-form')
    const data = readForm()
    if (!data.title) return
    const task = state.editing
      ? { ...state.editing, ...data }
      : { ...data, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
    await store.saveTask(task)
    $('#task-dialog').close()
    await reload()
    render()
    await refreshNotifications()
  })

  setInterval(() => {
    if (state.tab === 'today') renderToday()
  }, 30000)

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
