import { dateKey, projectDay, countdown, fitnessSummary } from './model.js'
import * as store from './store.js'

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

/* ---------------- 今日 ---------------- */

function chipFor(task) {
  if (!task.deadline) return null
  const info = countdown(task.deadline, new Date(), state.settings?.countdownThresholds)
  if (!info) return null
  return el('span', `chip chip-${info.level}`, info.label)
}

function taskRow(entry) {
  const { task, done } = entry
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
  return row
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

function renderCalendar() {
  $('#view').replaceChildren(el('div', 'placeholder', '月历视图将在 P3 实现'))
}

function renderRecords() {
  $('#view').replaceChildren(el('div', 'placeholder', '每日日志与记录卡将在 P2 实现'))
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
  await detectVersion()
  await reload()
  render()

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
  })

  setInterval(() => {
    if (state.tab === 'today') renderToday()
  }, 30000)

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  }
}

boot().catch((error) => {
  document.body.innerHTML = `<pre class="fatal">启动失败：${error.message}</pre>`
})
