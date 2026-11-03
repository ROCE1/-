// 无头浏览器冒烟测试：起一个本地静态服务 → 用 Edge/Chrome 的无头模式打开 → 走一遍主要页面。
//
//   node scripts/smoke.mjs
//
// 说明：
// - 需要本机装了 Edge 或 Chrome；找不到就跳过（退出码 0），不影响 CI。
// - 环境有沙箱时会禁止浏览器创建命名管道，必须在“完整权限”下跑，否则会卡住。
// - 这不是单元测试，只回答一个问题：页面能不能正常启动、几个页签能不能画出来。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..', 'www')
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(probe, { timeout = 15000, interval = 120, label = '条件' } = {}) {
  const start = Date.now()
  for (;;) {
    try {
      const value = await probe()
      if (value) return value
    } catch {
      /* 还没准备好，继续等 */
    }
    if (Date.now() - start > timeout) throw new Error(`等待超时：${label}`)
    await sleep(interval)
  }
}

function startServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\//, '')
    const file = path.join(root, rel)
    if (!file.startsWith(root)) {
      res.writeHead(403).end('forbidden')
      return
    }
    try {
      const data = await readFile(file)
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
      })
      res.end(data)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

class Cdp {
  constructor(socket) {
    this.socket = socket
    this.nextId = 0
    this.pending = new Map()
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const waiter = message.id && this.pending.get(message.id)
      if (!waiter) return
      this.pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message))
      else waiter.resolve(message.result)
    })
  }

  send(method, params = {}) {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
}

async function connectCdp(browser, port, profile) {
  const child = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  const target = await waitFor(
    async () => {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      const list = await res.json()
      const page = list.find((item) => item.type === 'page')
      return page?.webSocketDebuggerUrl
    },
    { timeout: 20000, label: '浏览器调试端口' },
  )

  const socket = new WebSocket(target)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('CDP 连接失败')), { once: true })
  })
  return { child, cdp: new Cdp(socket) }
}

async function main() {
  const browser = BROWSERS.find((item) => existsSync(item))
  if (!browser) {
    console.log('没找到 Edge/Chrome，跳过冒烟测试')
    return 0
  }

  const server = await startServer()
  const { port } = server.address()
  const profile = path.join(os.tmpdir(), `lyapp-smoke-${Date.now()}`)
  const debugPort = 9334
  let child = null

  const failures = []
  const check = (name, ok, detail = '') => {
    if (ok) console.log(`ok   ${name}`)
    else {
      failures.push(name)
      console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
    }
  }

  try {
    const connection = await connectCdp(browser, debugPort, profile)
    child = connection.child
    const { cdp } = connection

    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source:
        'window.__errors = [];' +
        'addEventListener("error", (event) => window.__errors.push(String(event.message)));' +
        'addEventListener("unhandledrejection", (event) => window.__errors.push("rejection: " + String(event.reason)));',
    })

    const evaluate = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
      }
      return result.result.value
    }

    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` })

    await waitFor(
      async () => evaluate(`document.querySelector('#today-date')?.textContent?.includes('-')`),
      { label: '应用启动（顶栏日期）' },
    )

    const bodyText = await evaluate('document.body.innerText')
    check('页面没有启动失败', !bodyText.includes('启动失败'), bodyText.slice(0, 120))
    check('今日页有分区', bodyText.includes('紧急') && bodyText.includes('主线') && bodyText.includes('支线'))
    check('底部有六个页签', (await evaluate(`document.querySelectorAll('.tab').length`)) === 6)

    // 新建两条主线任务（用于排序）
    for (const name of ['冒烟任务B', '冒烟任务A']) {
      await evaluate(`document.querySelector('#add-task').click()`)
      await waitFor(() => evaluate(`document.querySelector('#task-dialog')?.open === true`), { label: '任务弹窗' })
      await evaluate(`
        (() => {
          const form = document.querySelector('#task-form')
          form.elements.title.value = '${name}'
          form.elements.type.value = 'main'
          form.requestSubmit()
        })()
      `)
      await waitFor(() => evaluate(`document.body.innerText.includes('${name}')`), { label: `任务 ${name} 写入` })
    }
    check('新建任务出现在今日列表', true)

    const mainTitles = () => evaluate(`Array.from(document.querySelectorAll('.group-main .task-title')).map((n) => n.textContent).join('|')`)
    check('无截止时间时按标题排序', (await mainTitles()) === '冒烟任务A|冒烟任务B', await mainTitles())

    // 手动排序：打开排序模式，把第一条下移
    await evaluate(`document.querySelector('.chip-toggle').click()`)
    await waitFor(() => evaluate(`document.querySelectorAll('.group-main .order-btn').length >= 4`), { label: '排序按钮' })
    await evaluate(`
      const rows = Array.from(document.querySelectorAll('.group-main .task'))
      rows[0].querySelectorAll('.order-btn')[1].click()
    `)
    await waitFor(async () => (await mainTitles()) === '冒烟任务B|冒烟任务A', { label: '排序生效' })
    check('排序按钮能调换顺序', true)
    await evaluate(`document.querySelector('.chip-toggle').click()`)
    await waitFor(() => evaluate(`document.querySelectorAll('.order-btn').length === 0`), { label: '退出排序模式' })
    check('排序结果在退出排序模式后保留', (await mainTitles()) === '冒烟任务B|冒烟任务A', await mainTitles())

    // 勾选任务完成
    await evaluate(`
      Array.from(document.querySelectorAll('#view .task'))
        .find((row) => row.innerText.includes('冒烟任务A'))
        .querySelector('.check')
        .click()
    `)
    await waitFor(() => evaluate(`document.body.innerText.includes('已完成 1 / 2')`), { label: '任务完成计数' })
    check('任务勾选后计数更新', true)

    // 健身页：轮换页签 + 新建一条力量项
    await evaluate(`document.querySelector('[data-tab="fitness"]').click()`)
    await waitFor(() => evaluate(`!!document.querySelector('.segmented')`), { label: '健身页' })
    const fitnessText = await evaluate(`document.querySelector('#view').innerText`)
    check('健身页有力量日/有氧日', fitnessText.includes('力量日') && fitnessText.includes('有氧日'), fitnessText.slice(0, 80))

    await evaluate(`document.querySelector('#add-task').click()`)
    await waitFor(() => evaluate(`document.querySelector('#fitness-dialog')?.open === true`), { label: '健身弹窗' })
    await evaluate(`
      document.querySelector('#fitness-form [name="name"]').value = '卧推'
      document.querySelector('#fitness-form [name="sets"]').value = '4'
      document.querySelector('#fitness-form [name="reps"]').value = '8'
      document.querySelector('#fitness-form').requestSubmit()
    `)
    await waitFor(() => evaluate(`document.body.innerText.includes('4 组 × 8 个')`), { label: '健身项写入并显示' })
    check('新建健身项显示组 × 个', true)

    // 勾选完成
    await evaluate(`document.querySelector('#view .check')?.click()`)
    await waitFor(() => evaluate(`!!document.querySelector('#view .task.done')`), { label: '勾选完成' })
    check('健身项可整条勾选', true)

    // 日历页
    await evaluate(`document.querySelector('[data-tab="calendar"]').click()`)
    await waitFor(() => evaluate(`!!document.querySelector('.cal-grid')`), { label: '日历页' })
    const calTitle = await evaluate(`document.querySelector('.cal-title').textContent`)
    check('日历显示年月', /年 \d+ 月/.test(calTitle), calTitle)
    const cellCount = await evaluate(`document.querySelectorAll('.cal-cell').length`)
    check('日历格子是 7 的倍数', cellCount % 7 === 0 && cellCount >= 28, `格子数 ${cellCount}`)
    const todayMarked = await evaluate(`document.querySelectorAll('.cal-cell.today').length`)
    check('今天被标出来', todayMarked === 1, `today=${todayMarked}`)

    // 记录页
    await evaluate(`document.querySelector('[data-tab="records"]').click()`)
    await waitFor(() => evaluate(`document.body.innerText.includes('每日总结')`), { label: '记录页' })
    check('记录页有每日总结与记录卡', await evaluate(`document.body.innerText.includes('记录卡')`))

    // 写一篇总结，页面应立即出现
    await evaluate(`document.querySelector('#view .ghost')?.click()`)
    await waitFor(() => evaluate(`document.querySelector('#summary-dialog')?.open === true`), { label: '总结弹窗' })
    await evaluate(`
      document.querySelector('#summary-form [name="summary"]').value = '冒烟测试写的一行'
      document.querySelector('#summary-form').requestSubmit()
    `)
    await waitFor(() => evaluate(`document.body.innerText.includes('冒烟测试写的一行')`), { label: '总结出现在列表' })
    check('总结保存后出现在历史列表', true)

    // 统计页：两个环图 + 明细
    await evaluate(`document.querySelector('[data-tab="stats"]').click()`)
    await waitFor(() => evaluate(`document.querySelectorAll('#view .ring').length === 2`), { label: '统计页' })
    const statsText = await evaluate(`document.querySelector('#view').innerText`)
    check('统计页有今日/本周环图', statsText.includes('今日') && statsText.includes('本周') && statsText.includes('%'), statsText.slice(0, 80))
    check('统计页有明细行', statsText.includes('今日工作') && statsText.includes('本周空闲'))

    // 设置页
    await evaluate(`document.querySelector('[data-tab="settings"]').click()`)
    await waitFor(() => evaluate(`document.body.innerText.includes('背景')`), { label: '设置页' })
    const settingsText = await evaluate(`document.querySelector('#view').innerText`)
    check('设置页有背景与主题', settingsText.includes('背景') && settingsText.includes('主题'))
    check('设置页有版本号', /版本 \d+\.\d+\.\d+/.test(settingsText), settingsText.slice(-60))

    // 背景图：塞一张真实图片走完整条链路（缩图 → IndexedDB blob → CSS 变量 → 滑杆）
    await evaluate(`
      (async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 64
        canvas.height = 48
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#ff0000'
        ctx.fillRect(0, 0, 64, 48)
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
        const file = new File([blob], 'smoke.png', { type: 'image/png' })
        const transfer = new DataTransfer()
        transfer.items.add(file)
        const input = document.querySelector('#view input[type="file"]')
        input.files = transfer.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
      })()
    `)
    await waitFor(
      async () => {
        const value = await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--bg-image')`)
        return typeof value === 'string' && value.includes('blob:')
      },
      { label: '背景图写入并生效' },
    )
    check('选图后背景图层生效', true)
    check('背景滑杆出现', (await evaluate(`document.querySelectorAll('#view .slider-row').length`)) === 2)

    await evaluate(`
      const slider = document.querySelectorAll('#view .slider-row input[type="range"]')[0]
      slider.value = '80'
      slider.dispatchEvent(new Event('input', { bubbles: true }))
    `)
    const opacity = await evaluate(
      `getComputedStyle(document.documentElement).getPropertyValue('--bg-opacity').trim()`,
    )
    check('透明度滑杆实时生效', opacity === '0.8', `--bg-opacity=${opacity}`)

    await evaluate(
      `Array.from(document.querySelectorAll('#view button')).find((b) => b.textContent === '恢复默认').click()`,
    )
    await waitFor(
      async () => (await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--bg-image').trim()`)) === 'none',
      { label: '恢复默认背景' },
    )
    check('恢复默认会清掉背景', true)

    const errors = await evaluate('window.__errors')
    check('页面没有 JS 报错', Array.isArray(errors) && errors.length === 0, JSON.stringify(errors))
  } finally {
    child?.kill()
    server.close()
    await sleep(300)
    await rm(profile, { recursive: true, force: true }).catch(() => {})
  }

  console.log(`\n${failures.length === 0 ? '冒烟测试通过' : `失败 ${failures.length} 项：${failures.join('、')}`}`)
  return failures.length === 0 ? 0 : 1
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`冒烟测试异常：${error.message}`)
    process.exit(1)
  })
