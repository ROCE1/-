// 生成 electron-updater 能读的 latest.yml。
// 注意：不要硬编码安装包文件名 —— electron-builder 的 artifactName 改过一次
// （去掉空格，因为 GitHub 上传资产时会把空格替换成点），硬编码就会 ENOENT。
// 这里按“带版本号、以 -setup.exe 结尾”去 release/ 里找，找不到就明确报错。
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version
const releaseDir = path.join(root, 'release')

const candidates = readdirSync(releaseDir).filter(
  (name) => name.endsWith('-setup.exe') && !name.includes('__uninstaller'),
)
if (candidates.length === 0) {
  console.error(`release/ 里没有找到安装包（期望 *-setup.exe），目录内容：`)
  console.error(readdirSync(releaseDir).join('\n'))
  process.exit(1)
}

const fileName = candidates.sort().at(-1)
const filePath = path.join(releaseDir, fileName)
const buffer = readFileSync(filePath)
const sha512 = createHash('sha512').update(buffer).digest('base64')

const manifest = [
  `version: ${version}`,
  'files:',
  `  - url: ${fileName}`,
  `    sha512: ${sha512}`,
  `    size: ${buffer.length}`,
  `path: ${fileName}`,
  `sha512: ${sha512}`,
  `releaseDate: '${new Date().toISOString()}'`,
  '',
].join('\n')

const out = path.join(releaseDir, 'latest.yml')
writeFileSync(out, manifest)
console.log(`latest.yml -> ${out}`)
console.log(`file=${fileName} version=${version} size=${buffer.length} sha512=${sha512.slice(0, 16)}...`)
