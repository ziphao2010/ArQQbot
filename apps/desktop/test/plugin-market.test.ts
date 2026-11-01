// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { create } from 'tar'
import { afterEach, describe, expect, it } from 'vitest'
import type { PluginMarketEntry } from '@arqqbot/shared'
import { PluginMarketplace } from '@arqqbot/control'

const tempDirs: string[] = []
let fixtureSeq = 0

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

async function makeTarball(
  tempRoot: string,
  id: string,
  options: { version?: string; withEntry?: boolean } = {}
): Promise<Buffer> {
  const sourceDir = path.join(tempRoot, `source-${id}-${fixtureSeq++}`)
  const packageDir = path.join(sourceDir, 'package')
  await mkdir(path.join(packageDir, 'dist'), { recursive: true })

  const pkg = {
    name: `arqqbot-plugin-${id}`,
    version: options.version ?? '0.1.0',
    arqqbot: {
      id,
      displayName: '测试插件',
      description: '测试插件描述',
      schema: { type: 'object', properties: {} },
      defaultConfig: {}
    }
  }
  await writeFile(path.join(packageDir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8')
  if (options.withEntry !== false) {
    await writeFile(path.join(packageDir, 'dist', 'index.js'), 'export const plugin = {}\n', 'utf8')
  }

  const archivePath = path.join(tempRoot, `${id}-${fixtureSeq++}.tar.gz`)
  await create({ cwd: sourceDir, file: archivePath, gzip: true, portable: true }, ['package'])
  return readFile(archivePath)
}

function makeFetch(indexBody: string, downloadUrl: string, archive: Buffer): typeof fetch {
  return (async (input: unknown) => {
    const url = String(input)
    if (url === downloadUrl) return new Response(new Uint8Array(archive))
    return new Response(indexBody, {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }) as unknown as typeof fetch
}

function entryFor(
  id: string,
  downloadUrl: string,
  extras: Partial<PluginMarketEntry> = {}
): PluginMarketEntry {
  return {
    id,
    packageName: `arqqbot-plugin-${id}`,
    displayName: '测试插件',
    description: '测试插件描述',
    version: '0.1.0',
    repo: `https://github.com/owner/arqqbot-plugin-${id}`,
    commit: '0123456789abcdef0123456789abcdef01234567',
    downloadUrl,
    sha256: null,
    ...extras
  }
}

async function writeInstalledPlugin(rootDir: string, id: string): Promise<void> {
  const dir = path.join(rootDir, id)
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: `arqqbot-plugin-${id}`,
      version: '0.1.0',
      arqqbot: {
        id,
        displayName: '已安装插件',
        description: '',
        schema: { type: 'object' },
        defaultConfig: {}
      }
    }),
    'utf8'
  )
}

describe('PluginMarketplace', () => {
  it('拉取索引、过滤非法条目并列出已安装插件', async () => {
    const rootDir = await makeTempDir('arqqbot-market-root-')
    const fixtureDir = await makeTempDir('arqqbot-market-fixture-')
    await writeInstalledPlugin(rootDir, 'existing')

    const downloadUrl = 'https://example.com/plugin-example.tar.gz'
    const archive = await makeTarball(fixtureDir, 'example')
    const valid = entryFor('example', downloadUrl)
    const index = {
      version: 1,
      generatedAt: '2026-11-01T00:00:00.000Z',
      source: 'github-topic:arqqbot-plugin',
      plugins: [valid, { ...valid, id: 'Invalid', downloadUrl: 'ftp://example.com/plugin.tar.gz' }]
    }

    const marketplace = new PluginMarketplace({
      rootDir,
      indexUrl: 'https://example.com/index.json',
      fetchImpl: makeFetch(JSON.stringify(index), downloadUrl, archive)
    })

    const snapshot = await marketplace.fetchIndex()

    expect(snapshot.indexUrl).toBe('https://example.com/index.json')
    expect(snapshot.generatedAt).toBe('2026-11-01T00:00:00.000Z')
    expect(snapshot.plugins).toEqual([valid])
    expect(snapshot.installedIds).toEqual(['existing'])
    expect(snapshot.error).toBeUndefined()
  })

  it('安装插件到外部插件目录并可被发现', async () => {
    const rootDir = await makeTempDir('arqqbot-market-root-')
    const fixtureDir = await makeTempDir('arqqbot-market-fixture-')
    const downloadUrl = 'https://example.com/plugin-example.tar.gz'
    const archive = await makeTarball(fixtureDir, 'example')
    const entry = entryFor('example', downloadUrl, {
      sha256: createHash('sha256').update(archive).digest('hex')
    })

    const marketplace = new PluginMarketplace({
      rootDir,
      fetchImpl: makeFetch('', downloadUrl, archive)
    })

    await marketplace.install(entry)

    expect(await marketplace.listInstalled()).toEqual(['example'])
    const installedPkg = JSON.parse(
      await readFile(path.join(rootDir, 'example', 'package.json'), 'utf8')
    ) as { version: string }
    expect(installedPkg.version).toBe('0.1.0')
    expect(await readFile(path.join(rootDir, 'example', 'dist', 'index.js'), 'utf8')).toContain(
      'export const plugin'
    )
  })

  it('sha256 不匹配时安装失败且不写入目录', async () => {
    const rootDir = await makeTempDir('arqqbot-market-root-')
    const fixtureDir = await makeTempDir('arqqbot-market-fixture-')
    const downloadUrl = 'https://example.com/plugin-example.tar.gz'
    const archive = await makeTarball(fixtureDir, 'example')
    const entry = entryFor('example', downloadUrl, { sha256: '0'.repeat(64) })

    const marketplace = new PluginMarketplace({
      rootDir,
      fetchImpl: makeFetch('', downloadUrl, archive)
    })

    await expect(marketplace.install(entry)).rejects.toThrow('sha256 校验失败')
    expect(await marketplace.listInstalled()).toEqual([])
  })

  it('重复安装已存在的插件失败', async () => {
    const rootDir = await makeTempDir('arqqbot-market-root-')
    const fixtureDir = await makeTempDir('arqqbot-market-fixture-')
    const downloadUrl = 'https://example.com/plugin-example.tar.gz'
    const archive = await makeTarball(fixtureDir, 'example')
    const entry = entryFor('example', downloadUrl)

    const marketplace = new PluginMarketplace({
      rootDir,
      fetchImpl: makeFetch('', downloadUrl, archive)
    })

    await marketplace.install(entry)
    await expect(marketplace.install(entry)).rejects.toThrow('插件已安装')
  })

  it('缺少入口文件时安装失败', async () => {
    const rootDir = await makeTempDir('arqqbot-market-root-')
    const fixtureDir = await makeTempDir('arqqbot-market-fixture-')
    const downloadUrl = 'https://example.com/plugin-example.tar.gz'
    const archive = await makeTarball(fixtureDir, 'example', { withEntry: false })
    const entry = entryFor('example', downloadUrl)

    const marketplace = new PluginMarketplace({
      rootDir,
      fetchImpl: makeFetch('', downloadUrl, archive)
    })

    await expect(marketplace.install(entry)).rejects.toThrow('插件入口不存在')
    expect(await marketplace.listInstalled()).toEqual([])
  })

  it('非法索引返回带 error 的快照', async () => {
    const rootDir = await makeTempDir('arqqbot-market-root-')
    const marketplace = new PluginMarketplace({
      rootDir,
      fetchImpl: makeFetch('{ not valid json', 'https://example.com/plugin.tar.gz', Buffer.alloc(0))
    })

    const snapshot = await marketplace.fetchIndex('https://example.com/index.json')

    expect(snapshot.error).toBe('索引 JSON 解析失败')
    expect(snapshot.plugins).toEqual([])
    expect(snapshot.installedIds).toEqual([])
  })

  it('默认索引失败时回退到 GitHub raw 地址', async () => {
    const rootDir = await makeTempDir('arqqbot-market-root-')
    const rawUrl = 'https://raw.githubusercontent.com/ziphao2010/ArQQbot/main/plugins/index.json'
    const index = {
      version: 1,
      generatedAt: '2026-11-01T00:00:00.000Z',
      source: 'github-topic:arqqbot-plugin',
      plugins: []
    }

    const fetchImpl = (async (input: unknown) => {
      const url = String(input)
      if (url === rawUrl) {
        return new Response(JSON.stringify(index), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      return new Response('', { status: 404 })
    }) as unknown as typeof fetch

    const marketplace = new PluginMarketplace({ rootDir, fetchImpl })
    const snapshot = await marketplace.fetchIndex()

    expect(snapshot.indexUrl).toBe(rawUrl)
    expect(snapshot.plugins).toEqual([])
    expect(snapshot.generatedAt).toBe('2026-11-01T00:00:00.000Z')
    expect(snapshot.error).toBeUndefined()
  })

  it('主下载地址失败时回退到 GitHub archive 地址', async () => {
    const rootDir = await makeTempDir('arqqbot-market-root-')
    const fixtureDir = await makeTempDir('arqqbot-market-fixture-')
    const commit = '0123456789abcdef0123456789abcdef01234567'
    const primaryUrl = 'https://example.com/plugin-example.tar.gz'
    const archiveUrl = `https://github.com/owner/arqqbot-plugin-example/archive/${commit}.tar.gz`
    const archive = await makeTarball(fixtureDir, 'example')
    const entry = entryFor('example', primaryUrl, { commit })

    const fetchImpl = (async (input: unknown) => {
      const url = String(input)
      if (url === archiveUrl) return new Response(new Uint8Array(archive))
      return new Response('', { status: 502 })
    }) as unknown as typeof fetch

    const marketplace = new PluginMarketplace({ rootDir, fetchImpl })
    await marketplace.install(entry)

    expect(await marketplace.listInstalled()).toEqual(['example'])
    expect(
      await readFile(path.join(rootDir, 'example', 'dist', 'index.js'), 'utf8')
    ).toContain('export const plugin')
  })
})
