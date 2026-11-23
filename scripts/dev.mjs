/**
 * 本地开发启动器
 *
 * 为什么不用 `vite` 直接起 dev server：
 * 当前工作区路径包含 `%`（项目制课程-5%），Vite 的 dev server 在处理
 * index.html 时会执行 decodeURIComponent，路径里的 `%` 会被当成非法转义，
 * 直接抛 "URI malformed" 并返回 500。这个问题与 base 配置无关，是路径本身导致的。
 *
 * 绕开方式：改用 `vite build --watch` 持续产出静态文件，再用 `vite preview` 提供服务。
 * 代价是没有 HMR，改完代码后刷新浏览器即可。
 */
import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const viteBin = path.join('node_modules', 'vite', 'bin', 'vite.js')

if (!existsSync(viteBin)) {
  console.error('[dev] 找不到 vite，请先执行 npm install')
  process.exit(1)
}

console.log('[dev] 首次构建中…')
execSync(`"${process.execPath}" "${viteBin}" build`, { stdio: 'inherit' })

const watch = spawn(process.execPath, [viteBin, 'build', '--watch'], { stdio: 'inherit' })
const preview = spawn(
  process.execPath,
  [viteBin, 'preview', '--port', '4173', '--host'],
  { stdio: 'inherit' },
)

let closing = false
function shutdown(code = 0) {
  if (closing) return
  closing = true
  watch.kill('SIGTERM')
  preview.kill('SIGTERM')
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
watch.on('exit', (code) => {
  if (code !== null && code !== 0) shutdown(code)
})
preview.on('exit', (code) => shutdown(code ?? 0))
