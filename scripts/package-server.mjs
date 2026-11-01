#!/usr/bin/env node
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'dist-server', 'arqqbot-server')

async function main() {
  const pkg = JSON.parse(await readFile(path.join(root, 'apps/server/package.json'), 'utf8'))
  await rm(path.join(root, 'dist-server'), { recursive: true, force: true })
  await mkdir(target, { recursive: true })

  execFileSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['--filter', '@arqqbot/server', 'deploy', '--prod', '--legacy', target],
    { cwd: root, stdio: 'inherit' }
  )

  const copies = [
    ['packages/runtime/dist/worker-entry.cjs', 'runtime/worker-entry.cjs'],
    ['apps/desktop/out/renderer-web', 'web'],
    ['packages/plugin-echo/package.json', 'builtin/plugin-echo/package.json'],
    ['packages/plugin-echo/dist', 'builtin/plugin-echo/dist'],
    ['packages/plugin-persona-distill/package.json', 'builtin/plugin-persona-distill/package.json'],
    ['packages/plugin-persona-distill/dist', 'builtin/plugin-persona-distill/dist']
  ]
  for (const [from, to] of copies) {
    await cp(path.join(root, from), path.join(target, to), { recursive: true })
  }

  await cp(path.join(root, 'deploy/arqqbot.service'), path.join(target, 'arqqbot.service'))
  await cp(path.join(root, 'docs/headless.md'), path.join(target, 'README-headless.md'))

  console.log(`服务端发布目录已生成：${target} (v${pkg.version})`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
