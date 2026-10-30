// 生成 electron-updater 能读的 latest.yml。
// 我们不走 electron-builder 的 publish（本机访问 GitHub 资产不稳定），
// 所以自己算 sha512 + size，产出的文件手传到 Release 即可。
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version
const fileName = `DSH App-${version}-setup.exe`
const filePath = path.join(root, 'release', fileName)
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

const out = path.join(root, 'release', 'latest.yml')
writeFileSync(out, manifest)
console.log(`latest.yml -> ${out}`)
console.log(`version=${version} size=${buffer.length} sha512=${sha512.slice(0, 16)}...`)
