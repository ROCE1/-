/**
 * 原生能力的前端封装（只在安卓 App 里生效；浏览器里全部是空实现）。
 * 对应的原生插件：android/.../TaskNotificationsPlugin.java
 */
const plugin = () => window.Capacitor?.Plugins?.TaskNotifications

export function isNative() {
  return Boolean(plugin())
}

export async function syncState({
  title,
  text,
  busy,
  progressDone,
  progressTotal,
  widgetColor,
  widgetOpacity,
}) {
  const api = plugin()
  if (!api) return null
  try {
    return await api.syncState({
      title,
      text,
      busy,
      progressDone,
      progressTotal,
      widgetColor,
      widgetOpacity,
    })
  } catch (error) {
    console.warn('[native] syncState 失败', error)
    return null
  }
}

/**
 * 通知栏上的「繁忙 / 空闲」按钮是原生直接处理的，这里把用户那次点击取回来，
 * 由前端补写工作时段（sessions 在 IndexedDB 里，只有前端能写）。
 * 返回 { busy, at } 或 null；取过一次就清掉。
 */
export async function consumeBusyToggle() {
  const api = plugin()
  if (!api) return null
  try {
    const result = await api.consumeBusyToggle()
    if (!result || typeof result.busy !== 'boolean') return null
    return { busy: result.busy, at: Number(result.at) || Date.now() }
  } catch {
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
