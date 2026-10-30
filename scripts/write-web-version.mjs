// 把 package.json 的版本写进 www/app-version.json：
// 安卓/网页端没有主进程可读版本号，页面靠这个文件显示当前版本。
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const out = path.join(root, 'www', 'app-version.json')
writeFileSync(out, `${JSON.stringify({ version }, null, 2)}\n`)
console.log(`app-version.json -> ${version}`)
