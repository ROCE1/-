/**
 * 本地存储：IndexedDB。
 * 选择 IndexedDB 而不是 localStorage：容量大、异步不卡界面、WebView 里也能持久化。
 * 后续要做云同步时，把这里换成"本地库 + 同步队列"即可，调用方不用改。
 */
const DB_NAME = 'lyapp'
// v2：新增 fitness（健身项独立于任务）；老库升级时只补建缺的 store，数据不动。
const DB_VERSION = 2

const STORES = ['tasks', 'occurrences', 'settings', 'sessions', 'journal', 'cards', 'phrases', 'fitness']

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          if (name === 'settings') db.createObjectStore(name, { keyPath: 'key' })
          else if (name === 'occurrences') db.createObjectStore(name, { keyPath: 'key' })
          else if (name === 'journal') db.createObjectStore(name, { keyPath: 'date' })
          else db.createObjectStore(name, { keyPath: 'id' })
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

function run(storeName, mode, action) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode)
        const store = tx.objectStore(storeName)
        let result
        try {
          result = action(store)
        } catch (error) {
          reject(error)
          return
        }
        tx.oncomplete = () => resolve(result && result.__req ? result.__req.result : result)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

const req = (r) => ({ __req: r })

export function getAll(storeName) {
  return run(storeName, 'readonly', (store) => req(store.getAll()))
}

export function getOne(storeName, key) {
  return run(storeName, 'readonly', (store) => req(store.get(key)))
}

export function put(storeName, value) {
  return run(storeName, 'readwrite', (store) => {
    store.put(value)
    return value
  })
}

export function remove(storeName, key) {
  return run(storeName, 'readwrite', (store) => {
    store.delete(key)
  })
}

export function clear(storeName) {
  return run(storeName, 'readwrite', (store) => {
    store.clear()
  })
}

/* ---------- 领域封装 ---------- */

export const DEFAULT_SETTINGS = {
  summaryTime: '22:00',
  countdownThresholds: { green: 48, yellow: 12, orange: 4, red: 1 },
  leadMinutes: 15, // 截止提前提醒的全局默认值（任务里可单独覆盖）
  fitnessReminders: [],
  fitnessAnchor: '', // 健身轮换基准日，首次打开健身页时写入
  fitnessOverride: null, // { date, day }：当天手动切换，跨天自动失效
  widgetColor: '#171a21', // 安卓桌面小组件背景色
  widgetOpacity: 0.95,
  lockScreenEnabled: true,
  busy: false,
}

export async function loadSettings() {
  const rows = await getAll('settings')
  const map = {}
  for (const row of rows) map[row.key] = row.value
  return { ...DEFAULT_SETTINGS, ...map }
}

export async function saveSetting(key, value) {
  await put('settings', { key, value })
}

export async function listTasks() {
  const tasks = await getAll('tasks')
  return tasks.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
}

export async function saveTask(task) {
  const record = { ...task, id: task.id || crypto.randomUUID(), createdAt: task.createdAt || new Date().toISOString() }
  await put('tasks', record)
  return record
}

export async function deleteTask(id) {
  await remove('tasks', id)
}

/** 完成状态按“任务 + 日期”存，常挂任务每天独立，互不串台。健身项共用同一张表。 */
export async function setDone(taskId, date, done) {
  const key = `${taskId}@${date}`
  if (!done) {
    await remove('occurrences', key)
    return
  }
  await put('occurrences', { key, taskId, date, done: true, doneAt: new Date().toISOString() })
}

export async function doneMapFor(date) {
  const all = await getAll('occurrences')
  const map = {}
  for (const row of all) if (row.date === date) map[row.key] = row.done
  return map
}

/* ---------- 健身项 ---------- */

export async function listFitnessItems() {
  const items = await getAll('fitness')
  return items.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
}

export async function saveFitnessItem(item) {
  const record = {
    ...item,
    id: item.id || crypto.randomUUID(),
    createdAt: item.createdAt || new Date().toISOString(),
  }
  await put('fitness', record)
  return record
}

export async function deleteFitnessItem(id) {
  await remove('fitness', id)
}

/**
 * 0.4.x 之前健身是 tasks 里的一种任务类型，现在拆成独立数据。
 * 迁移时保留原 id，这样 occurrences 里 `${id}@${date}` 的完成记录继续有效。
 * 返回迁移条数（0 表示无需迁移），可反复调用。
 */
export async function migrateFitnessTasks() {
  const tasks = await getAll('tasks')
  const legacy = tasks.filter((task) => task.type === 'fitness')
  for (const task of legacy) {
    await put('fitness', {
      id: task.id,
      name: task.title,
      day: 'strength',
      sets: null,
      reps: null,
      minutes: null,
      km: null,
      repeat: task.repeat || { kind: 'daily' },
      createdAt: task.createdAt || new Date().toISOString(),
      migratedFrom: 'task',
    })
    await remove('tasks', task.id)
  }
  return legacy.length
}

/* ---------- 背景图 ---------- */

/** 背景图存在 settings 的 background 记录里：{ blob, opacity, blur }。 */
export async function loadBackground() {
  const row = await getOne('settings', 'background')
  const value = row?.value
  // 导入的备份里可能是 dataUrl（还没转回 Blob），这里只认真正的 Blob
  if (!(value?.blob instanceof Blob)) return null
  return {
    blob: value.blob,
    opacity: typeof value.opacity === 'number' ? value.opacity : 0.45,
    blur: typeof value.blur === 'number' ? value.blur : 0,
  }
}

export async function saveBackground({ blob, opacity, blur }) {
  await put('settings', {
    key: 'background',
    value: { blob, opacity, blur, updatedAt: new Date().toISOString() },
  })
}

/** 只改两个滑杆，避免为了调 1% 透明度把几 MB 的图重写一遍。 */
export async function saveBackgroundTuning(opacity, blur) {
  const row = await getOne('settings', 'background')
  if (!row?.value?.blob) return
  await put('settings', { key: 'background', value: { ...row.value, opacity, blur } })
}

export async function clearBackground() {
  await remove('settings', 'background')
}

/* ---------- 备份 ---------- */

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function dataUrlToBlob(dataUrl) {
  const [meta, body] = String(dataUrl).split(',')
  const mime = /:(.*?);/.exec(meta)?.[1] || 'image/webp'
  const binary = atob(body || '')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/**
 * 导出全部数据。
 * 背景图是 Blob，JSON 存不下，所以单独转成 dataURL —— 否则备份“看着成功、恢复后背景没了”。
 */
export async function exportAll() {
  const data = {}
  for (const name of STORES) data[name] = await getAll(name)

  data.settings = await Promise.all(
    data.settings.map(async (row) => {
      if (row.key === 'background' && row.value?.blob instanceof Blob) {
        return {
          key: 'background',
          value: { ...row.value, blob: null, dataUrl: await blobToDataUrl(row.value.blob) },
        }
      }
      return row
    }),
  )

  return { version: 2, exportedAt: new Date().toISOString(), data }
}

export async function importAll(payload) {
  const data = payload?.data || payload
  for (const name of STORES) {
    if (!Array.isArray(data[name])) continue
    await clear(name)
    for (const row of data[name]) {
      // 背景图：把 dataURL 还原成 Blob 再落库
      if (name === 'settings' && row?.key === 'background' && typeof row.value?.dataUrl === 'string') {
        const { dataUrl, ...rest } = row.value
        await put(name, { key: 'background', value: { ...rest, blob: dataUrlToBlob(dataUrl) } })
        continue
      }
      await put(name, row)
    }
  }
}
