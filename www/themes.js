/**
 * 主题（皮肤）注册表 —— 为日后的配色/皮肤留的接口。
 *
 * 约定：界面里所有颜色都走 CSS 变量（见 style.css 的 :root），
 * 所以新增一套皮肤 = 往 THEMES 里加一个对象，不用改任何组件代码。
 *
 * 运行时也能注册（比如以后从云端拉皮肤、或用插件注入）：
 *   window.LYTheme.register({ id: 'ocean', name: '海洋', tokens: { '--bg': '#081420' } })
 *   window.LYTheme.apply('ocean')
 */

const BASE_TOKENS = [
  '--bg',
  '--panel',
  '--card',
  '--line',
  '--text',
  '--muted',
  '--accent',
  '--accent-2',
  '--on-accent',
  '--input-bg',
  '--chip-ok',
  '--chip-warn',
  '--chip-hot',
  '--chip-danger',
]

export const THEMES = [
  {
    id: 'dark',
    name: '暗夜（默认）',
    tokens: {
      '--bg': '#0f1115',
      '--panel': 'rgba(15, 17, 21, 0.94)',
      '--card': '#171a21',
      '--line': '#262b36',
      '--text': '#e6e9ef',
      '--muted': '#8b93a3',
      '--accent': '#4c8dff',
      '--accent-2': '#3a74e0',
      '--on-accent': '#ffffff',
      '--input-bg': '#101319',
      '--chip-ok': '#4ade80',
      '--chip-warn': '#fbbf24',
      '--chip-hot': '#fb923c',
      '--chip-danger': '#f87171',
    },
  },
  {
    id: 'light',
    name: '浅色',
    tokens: {
      '--bg': '#f5f6f8',
      '--panel': 'rgba(250, 251, 252, 0.96)',
      '--card': '#ffffff',
      '--line': '#e2e5ea',
      '--text': '#1b1f27',
      '--muted': '#6b7280',
      '--accent': '#2f6ee0',
      '--accent-2': '#2559c0',
      '--on-accent': '#ffffff',
      '--input-bg': '#ffffff',
      '--chip-ok': '#16a34a',
      '--chip-warn': '#b45309',
      '--chip-hot': '#c2410c',
      '--chip-danger': '#dc2626',
    },
  },
]

const listeners = new Set()

function registry() {
  return THEMES
}

export function list() {
  return registry().map(({ id, name }) => ({ id, name }))
}

export function find(id) {
  return registry().find((theme) => theme.id === id) || registry()[0]
}

/** 注册一套新皮肤（同 id 覆盖）。 */
export function register(theme) {
  if (!theme || !theme.id) throw new Error('skin 需要 id')
  const index = registry().findIndex((item) => item.id === theme.id)
  if (index >= 0) registry()[index] = theme
  else registry().push(theme)
}

/** 应用皮肤：把 token 写到 <html> 上，并记住当前 id。 */
export function apply(id, { persist = true } = {}) {
  const theme = find(id)
  const root = document.documentElement
  for (const token of BASE_TOKENS) {
    const value = theme.tokens?.[token]
    if (value) root.style.setProperty(token, value)
    else root.style.removeProperty(token)
  }
  root.dataset.theme = theme.id
  root.style.colorScheme = theme.id === 'light' ? 'light' : 'dark'
  if (persist) localStorage.setItem('lyapp:theme', theme.id)
  listeners.forEach((listener) => listener(theme))
  return theme
}

export function current() {
  return find(localStorage.getItem('lyapp:theme') || 'dark')
}

export function onChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// 暴露给外部（未来的皮肤包 / 插件 / 云端下发）
if (typeof window !== 'undefined') {
  window.LYTheme = { list, register, apply, current, onChange, THEMES }
}
