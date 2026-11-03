/**
 * 本地存储：IndexedDB。
 * 选择 IndexedDB 而不是 localStorage：容量大、异步不卡界面、WebView 里也能持久化。
 * 后续要做云同步时，把这里换成"本地库 + 同步队列"即可，调用方不用改。
 */
const DB_NAME = 'lyapp'
const DB_VERSION = 1

const STORES = ['tasks', 'occurrences', 'settings', 'sessions', 'journal', 'cards', 'phrases']

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
  fitnessReminders: [],
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

/** 完成状态按“任务 + 日期”存，常挂任务每天独立，互不串台。 */
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

export async function exportAll() {
  const data = {}
  for (const name of STORES) data[name] = await getAll(name)
  return { version: 1, exportedAt: new Date().toISOString(), data }
}

export async function importAll(payload) {
  const data = payload?.data || payload
  for (const name of STORES) {
    if (!Array.isArray(data[name])) continue
    await clear(name)
    for (const row of data[name]) await put(name, row)
  }
}
