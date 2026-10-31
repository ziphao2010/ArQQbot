import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanPluginCatalog } from '../src/catalog'

async function writePlugin(root: string, dir: string, id: string) {
  const pluginDir = path.join(root, dir)
  await mkdir(pluginDir, { recursive: true })
  await writeFile(
    path.join(pluginDir, 'package.json'),
    JSON.stringify({
      name: `arqqbot-plugin-${id}`,
      version: '0.1.0',
      main: 'dist/index.js',
      arqqbot: {
        id,
        displayName: id,
        description: '',
        schema: { type: 'object', properties: {} },
        defaultConfig: {}
      }
    }),
    'utf8'
  )
}

describe('scanPluginCatalog', () => {
  it('扫描内置与外部插件并按 id 去重', async () => {
    const builtin = await mkdtemp(path.join(tmpdir(), 'arqqbot-builtin-'))
    const external = await mkdtemp(path.join(tmpdir(), 'arqqbot-external-'))
    await writePlugin(builtin, 'plugin-echo', 'echo')
    await writePlugin(external, 'plugin-echo-copy', 'echo')
    await writePlugin(external, 'plugin-weather', 'weather')

    const result = await scanPluginCatalog([
      { path: builtin, source: 'builtin' },
      { path: external, source: 'external' }
    ])

    expect(result.items.map((item) => item.manifest.id)).toEqual(['echo', 'weather'])
    expect(result.items[0]?.source).toBe('builtin')
    expect(result.items[1]?.source).toBe('external')
    expect(result.warnings[0]?.message).toContain('插件 id 重复')
  })

  it('跳过没有 arqqbot 字段的目录', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'arqqbot-empty-'))
    await mkdir(path.join(root, 'not-a-plugin'), { recursive: true })
    await writeFile(path.join(root, 'not-a-plugin', 'package.json'), '{"name":"x","version":"1.0.0"}')

    const result = await scanPluginCatalog([{ path: root, source: 'external' }])
    expect(result.items).toEqual([])
  })
})
