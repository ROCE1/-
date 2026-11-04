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
  widgetTitle,
  widgetBody,
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
      widgetTitle,
      widgetBody,
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
 * 返回按时间排列的 [{ busy, at }]（可能是空数组）；取过一次就清空。
 */
export async function consumeBusyToggle() {
  const api = plugin()
  if (!api) return []
  try {
    const result = await api.consumeBusyToggle()
    const items = result?.items
    if (!Array.isArray(items) || items.length === 0) return []
    return items.map((item) => ({ busy: Boolean(item.busy), at: Number(item.at) || Date.now() }))
  } catch {
    return []
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

/** 自定义提醒音乐（只有安卓有）。 */
export async function alarmSoundInfo() {
  const api = plugin()
  if (!api) return { name: '' }
  try {
    return (await api.alarmSoundInfo()) || { name: '' }
  } catch {
    return { name: '' }
  }
}

export async function saveAlarmSound({ data, name }) {
  const api = plugin()
  if (!api) return { ok: false }
  try {
    return await api.saveAlarmSound({ data, name })
  } catch (error) {
    console.warn('[native] saveAlarmSound 失败', error)
    return { ok: false }
  }
}

export async function clearAlarmSound() {
  const api = plugin()
  if (!api) return null
  try {
    return await api.clearAlarmSound()
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
