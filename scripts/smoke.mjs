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

    // 四个分区：紧急 / 支线 / 日常 / 主线
    const sectionText = await evaluate(`document.querySelector('#view').innerText`)
    check(
      '今日有四个分区',
      ['紧急', '支线', '日常', '主线'].every((label) => sectionText.includes(label)),
      sectionText.slice(0, 80),
    )
    const sectionOrder = await evaluate(
      `Array.from(document.querySelectorAll('#view .group-title')).map((n) => n.textContent).join('|')`,
    )
    check('分区顺序 紧急→支线→日常→主线', sectionOrder === '紧急|支线|日常|主线', sectionOrder)

    // 表单精简：日常/主线收起倒计时等选项，紧急/支线才显示
    await evaluate(`document.querySelector('#add-task').click()`)
    await waitFor(() => evaluate(`document.querySelector('#task-dialog')?.open === true`), { label: '任务弹窗' })
    // 注意要看计算后的 display：光有 hidden 属性、被 CSS 盖掉的话屏幕上是能看见的（0.9.0 之前就是这个 bug）
    const visibleAdvCount = async (type) => {
      await evaluate(`
        (() => {
          const form = document.querySelector('#task-form')
          form.elements.type.value = '${type}'
          form.elements.type.dispatchEvent(new Event('change', { bubbles: true }))
        })()
      `)
      return evaluate(
        `Array.from(document.querySelectorAll('#task-form [data-adv]')).filter((n) => getComputedStyle(n).display !== 'none').length`,
      )
    }
    check('日常类型收起提醒/倒计时选项', (await visibleAdvCount('daily')) === 0)
    check('主线类型收起提醒/倒计时选项', (await visibleAdvCount('main')) === 0)
    check('紧急类型展开全部选项', (await visibleAdvCount('urgent')) > 0)

    // 重复子选项只在对应类型下显示（截图里「仅一次」还显示星期/间隔，就是这个 bug）
    const repeatSubCount = await evaluate(`
      (() => {
        const form = document.querySelector('#task-form')
        form.elements.repeatKind.value = 'once'
        form.elements.repeatKind.dispatchEvent(new Event('change', { bubbles: true }))
        return Array.from(document.querySelectorAll('#task-form [data-repeat]')).filter(
          (n) => getComputedStyle(n).display !== 'none',
        ).length
      })()
    `)
    check('重复子选项只显示当前那一个', repeatSubCount === 1, `同时显示 ${repeatSubCount} 个`)

    // 顺手用「日常」建一条
    await evaluate(`
      (() => {
        const form = document.querySelector('#task-form')
        form.elements.type.value = 'daily'
        form.elements.type.dispatchEvent(new Event('change', { bubbles: true }))
        form.elements.title.value = '喝水'
        form.requestSubmit()
      })()
    `)
    await waitFor(() => evaluate(`document.querySelector('.group-daily')?.innerText.includes('喝水')`), {
      label: '日常任务出现在日常分区',
    })
    check('可以新建日常任务', true)

    // 备注：点任务展开，再点收起
    await evaluate(`
      (() => {
        const row = Array.from(document.querySelectorAll('.group-daily .task')).find((r) => r.innerText.includes('喝水'))
        row.click()
      })()
    `)
    await waitFor(() => evaluate(`!!document.querySelector('.group-daily .task-notes.open')`), { label: '备注展开' })
    check('点任务能展开备注', true)
    await evaluate(`
      (() => {
        const row = Array.from(document.querySelectorAll('.group-daily .task')).find((r) => r.innerText.includes('喝水'))
        row.click()
      })()
    `)
    await waitFor(() => evaluate(`!document.querySelector('.group-daily .task-notes.open')`), { label: '备注收起' })
    check('再点一次能收起备注', true)

    // 繁忙 / 空闲切换（顺手给统计页造一条 session）
    await evaluate(`document.querySelector('#busy-toggle').click()`)
    await waitFor(() => evaluate(`document.querySelector('#busy-toggle').textContent === '繁忙中'`), { label: '切到繁忙' })
    await evaluate(`document.querySelector('#busy-toggle').click()`)
    await waitFor(() => evaluate(`document.querySelector('#busy-toggle').textContent === '空闲'`), { label: '切回空闲' })
    check('繁忙/空闲开关可用', true)

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

    // 写一张带标签的记录卡，然后按关键词 / 标签检索
    await evaluate(`Array.from(document.querySelectorAll('#view button')).find((b) => b.textContent === '写一张记录卡').click()`)
    await waitFor(() => evaluate(`document.querySelector('#card-dialog')?.open === true`), { label: '记录卡弹窗' })
    await evaluate(`
      document.querySelector('#card-form [name="title"]').value = '检索用卡片'
      document.querySelector('#card-form [name="body"]').value = '这是一条用于检索的正文'
      document.querySelector('#card-form [name="tags"]').value = '冒烟,检索'
      document.querySelector('#card-form').requestSubmit()
    `)
    await waitFor(() => evaluate(`document.body.innerText.includes('检索用卡片')`), { label: '记录卡保存' })
    check('记录卡可新建', true)

    await evaluate(`
      (() => {
        const searchBox = document.querySelector('#view input[type="search"]')
        searchBox.value = '不存在的关键词'
        searchBox.dispatchEvent(new Event('input', { bubbles: true }))
      })()
    `)
    await waitFor(() => evaluate(`document.body.innerText.includes('没有匹配的记录卡')`), { label: '关键词过滤' })
    check('记录卡关键词检索', true)

    await evaluate(`
      (() => {
        const searchBox = document.querySelector('#view input[type="search"]')
        searchBox.value = '检索用'
        searchBox.dispatchEvent(new Event('input', { bubbles: true }))
      })()
    `)
    await waitFor(() => evaluate(`document.body.innerText.includes('检索用卡片')`), { label: '检索命中' })

    await evaluate(
      `Array.from(document.querySelectorAll('#view .tag-chip')).find((b) => b.textContent === '#冒烟').click()`,
    )
    await waitFor(() => evaluate(`document.querySelectorAll('#view .tag-chip.active').length === 1`), { label: '标签过滤' })
    check('记录卡标签过滤', true)

    // 编辑记录卡：改正文，不应新增一条
    await evaluate(
      `Array.from(document.querySelectorAll('#view .card-actions button')).find((b) => b.textContent === '编辑').click()`,
    )
    await waitFor(() => evaluate(`document.querySelector('#card-dialog')?.open === true`), { label: '记录卡编辑弹窗' })
    const prefilled = await evaluate(`document.querySelector('#card-form [name="title"]').value`)
    check('编辑弹窗带出原标题', prefilled === '检索用卡片', prefilled)
    await evaluate(`
      (() => {
        const form = document.querySelector('#card-form')
        form.elements.body.value = '编辑后的正文'
        form.requestSubmit()
      })()
    `)
    await waitFor(() => evaluate(`document.body.innerText.includes('编辑后的正文')`), { label: '记录卡编辑生效' })
    const cardsAfterEdit = await evaluate(`document.querySelectorAll('#view .card').length`)
    check('编辑记录卡不会新增卡片', cardsAfterEdit === 1, `卡片数 ${cardsAfterEdit}`)

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

    // 本周 / 本月切换
    await evaluate(`Array.from(document.querySelectorAll('#view .seg')).find((b) => b.textContent === '本月').click()`)
    await waitFor(() => evaluate(`document.querySelector('#view').innerText.includes('本月工作')`), { label: '切到本月' })
    check('统计可切到本月', true)

    // 清空时间记录（confirm 直接放行）
    const recorded = await evaluate(`(document.querySelector('#view').innerText.match(/已记录 (\\d+) 段/) || [])[1] || '0'`)
    check('繁忙开关留下了时间记录', Number(recorded) >= 1, `记录段数 ${recorded}`)
    await evaluate(`
      window.confirm = () => true
      window.alert = (message) => { window.__lastAlert = String(message) }
      Array.from(document.querySelectorAll('#view button')).find((b) => b.textContent === '清空时间记录').click()
    `)
    await waitFor(() => evaluate(`document.body.innerText.includes('已记录 0 段')`), { label: '清空时间记录' })
    check('清空后记录归零', true)

    // 设置页
    await evaluate(`document.querySelector('[data-tab="settings"]').click()`)
    await waitFor(() => evaluate(`document.body.innerText.includes('背景')`), { label: '设置页' })
    const settingsText = await evaluate(`document.querySelector('#view').innerText`)
    check('设置页有背景与主题', settingsText.includes('背景') && settingsText.includes('主题'))
    check('设置页有版本号', /版本 \d+\.\d+\.\d+/.test(settingsText), settingsText.slice(-60))

    // 外观：切到「大」字号，html 的 font-size 应随之变化
    const fontSizeBefore = await evaluate(`getComputedStyle(document.documentElement).fontSize`)
    await evaluate(`Array.from(document.querySelectorAll('#view .seg')).find((b) => b.textContent === '大').click()`)
    await waitFor(
      async () => (await evaluate(`getComputedStyle(document.documentElement).fontSize`)) !== fontSizeBefore,
      { label: '字号切换' },
    )
    check('字号可切换', true, `${fontSizeBefore} → ${await evaluate(`getComputedStyle(document.documentElement).fontSize`)}`)

    // 颜色选择器存在（四个类型）
    const colorInputs = await evaluate(`document.querySelectorAll('#view .type-color-row input[type="color"]').length`)
    check('四种任务块颜色可调', colorInputs === 4, `颜色输入框 ${colorInputs} 个`)

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

    // 导入备份：造一份 JSON，走真实的文件选择 → 覆盖 → 页面出现
    await evaluate(`
      (() => {
        const payload = {
          version: 2,
          data: {
            cards: [
              {
                id: 'imported-1',
                createdAt: new Date().toISOString(),
                title: '导入的卡片',
                body: '来自备份',
                tags: ['备份'],
              },
            ],
          },
        }
        const file = new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' })
        const transfer = new DataTransfer()
        transfer.items.add(file)
        const input = Array.from(document.querySelectorAll('#view input[type="file"]')).find((node) =>
          String(node.accept || '').includes('json'),
        )
        input.files = transfer.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
      })()
    `)
    await sleep(1200)
    const importAlert = await evaluate(`window.__lastAlert || '(没有弹窗)'`)
    await evaluate(`document.querySelector('[data-tab="records"]').click()`)
    await waitFor(() => evaluate(`document.body.innerText.includes('检索条件') || document.querySelector('#view input[type="search"]') !== null`), {
      label: '记录页重新渲染',
    })
    // 记录页还留着上一次的检索条件，先清掉再看导入结果
    await evaluate(`Array.from(document.querySelectorAll('#view button')).find((b) => b.textContent === '清空')?.click()`)
    await sleep(300)
    const recordsText = await evaluate(`document.querySelector('#view').innerText`)
    check('导入后记录页能看到卡片', recordsText.includes('导入的卡片'), `${importAlert} / ${recordsText.slice(0, 120)}`)

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
