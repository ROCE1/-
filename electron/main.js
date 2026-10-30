const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { checkForUpdate, downloadInstaller } = require('./update')

// —— 日志先行：没有日志时“窗口空白后消失”只能靠猜。
let logFile = null
function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts
    .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
    .join(' ')}\n`
  try {
    if (!logFile) logFile = path.join(app.getPath('userData'), 'startup.log')
    fs.appendFileSync(logFile, line)
  } catch {
    /* 日志失败不能影响启动 */
  }
}

// 老显卡 / 远程桌面 / 驱动异常时 Chromium 的 GPU 进程最容易把窗口带崩。
app.disableHardwareAcceleration()

process.on('uncaughtException', (error) => log('uncaughtException', error.stack || String(error)))
process.on('unhandledRejection', (error) => log('unhandledRejection', String(error)))

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 720,
    minHeight: 520,
    title: 'DSH App',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.once('ready-to-show', () => {
    log('ready-to-show')
    win.show()
  })
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    log('did-fail-load', String(code), description, url)
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    log('render-process-gone', details)
  })
  win.webContents.on('console-message', (_event, level, message) => {
    log('console', String(level), message)
  })
  win.on('closed', () => log('window closed'))

  const entry = path.join(__dirname, '..', 'www', 'index.html')
  log('loading', entry, 'exists=', String(fs.existsSync(entry)))
  win.loadFile(entry).catch((error) => log('loadFile failed', error.stack || String(error)))
  return win
}

/** 流式计算文件 sha512（121 MB 不适合整个读进内存）。 */
function fileSha512(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512')
    fs.createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('base64')))
  })
}

app.whenReady().then(() => {
  log('app ready', `electron=${process.versions.electron}`, `node=${process.versions.node}`, `userData=${app.getPath('userData')}`)

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
  }))

  ipcMain.handle('update:check', () => checkForUpdate(app.getVersion()))

  ipcMain.handle('update:download', async (event, payload) => {
    const fileName = payload.file || 'update-setup.exe'
    const dir = path.join(app.getPath('temp'), 'dsh-app-update')
    log('download start', payload.url, fileName)

    const target = await downloadInstaller(payload.url, dir, fileName, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('update:progress', progress)
    })

    if (payload.sha512) {
      const actual = await fileSha512(target)
      if (actual !== payload.sha512) {
        fs.rmSync(target, { force: true })
        throw new Error('sha512 校验失败，安装包可能下载不完整')
      }
    }
    log('download done', target)
    return { ok: true, path: target }
  })

  ipcMain.handle('update:install', (_event, filePath) => {
    log('install', filePath)
    // NSIS 支持 /S 静默安装；detached 让安装器在应用退出后继续跑。
    const child = spawn(filePath, ['/S'], { detached: true, stdio: 'ignore' })
    child.unref()
    setTimeout(() => app.quit(), 800)
    return { ok: true }
  })

  ipcMain.handle('shell:open', (_event, url) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) return shell.openExternal(url)
    return false
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('child-process-gone', (_event, details) => log('child-process-gone', details))

app.on('window-all-closed', () => {
  log('all windows closed')
  if (process.platform !== 'darwin') app.quit()
})
