/**
 * 原生能力的前端封装（只在安卓 App 里生效；浏览器里全部是空实现）。
 * 对应的原生插件：android/.../TaskNotificationsPlugin.java
 */
const plugin = () => window.Capacitor?.Plugins?.TaskNotifications

export function isNative() {
  return Boolean(plugin())
}

export async function syncState({ title, text, busy }) {
  const api = plugin()
  if (!api) return null
  try {
    return await api.syncState({ title, text, busy })
  } catch (error) {
    console.warn('[native] syncState 失败', error)
    return null
  }
}

export async function schedule({ id, at, title, body, strong }) {
  const api = plugin()
  if (!api) return null
  try {
    return await api.schedule({ id, at, title, body, strong })
  } catch (error) {
    console.warn('[native] schedule 失败', error)
    return null
  }
}

export async function cancel(id) {
  const api = plugin()
  if (!api) return null
  try {
    return await api.cancel({ id })
  } catch {
    return null
  }
}

export async function cancelAll() {
  const api = plugin()
  if (!api) return null
  try {
    return await api.cancelAll()
  } catch {
    return null
  }
}

export async function status() {
  const api = plugin()
  if (!api) return null
  try {
    return await api.status()
  } catch {
    return null
  }
}

export async function requestPermissions() {
  const api = plugin()
  if (!api) return null
  try {
    return await api.requestPermissions()
  } catch {
    return null
  }
}

export async function openBatterySettings() {
  const api = plugin()
  if (!api) return null
  try {
    return await api.openBatterySettings()
  } catch {
    return null
  }
}

export async function openAppSettings() {
  const api = plugin()
  if (!api) return null
  try {
    return await api.openAppSettings()
  } catch {
    return null
  }
}
