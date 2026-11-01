import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const releaseDir = path.join(root, 'apps', 'desktop', 'release-local')

const candidates =
  process.platform === 'win32'
    ? [path.join(releaseDir, 'win-unpacked', 'ArQQBot.exe')]
    : process.platform === 'darwin'
      ? [
          path.join(releaseDir, 'mac', 'ArQQBot.app', 'Contents', 'MacOS', 'ArQQBot'),
          path.join(releaseDir, 'mac-arm64', 'ArQQBot.app', 'Contents', 'MacOS', 'ArQQBot')
        ]
      : [
          path.join(releaseDir, 'linux-unpacked', 'arqqbot'),
          path.join(releaseDir, 'linux-unpacked', 'ArQQBot')
        ]

const target = candidates.find(existsSync)
if (!target) {
  console.error(`未找到免安装桌面版，请先运行 pnpm build 与 electron-builder --dir：${releaseDir}`)
  process.exit(1)
}

const child = spawn(target, [], {
  cwd: path.dirname(target),
  detached: true,
  stdio: 'ignore'
})
child.unref()
console.log(`已启动免安装桌面版：${target}`)
