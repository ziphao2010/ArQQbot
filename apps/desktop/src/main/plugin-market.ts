import { createHash } from 'node:crypto'
import type { Stats } from 'node:fs'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { extract, type ReadEntry } from 'tar'
import type { PluginMarketEntry, PluginMarketSnapshot } from '@arqqbot/shared'
import { parsePluginManifest, pluginMarketEntrySchema } from '@arqqbot/shared'

const DEFAULT_INDEX_URLS = [
  'https://cdn.jsdelivr.net/gh/ziphao2010/ArQQbot@main/plugins/index.json',
  'https://raw.githubusercontent.com/ziphao2010/ArQQbot/main/plugins/index.json'
] as const
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024
const MAX_INDEX_BYTES = 2 * 1024 * 1024
const DEFAULT_ENTRY_PATH = 'dist/index.js'

export interface PluginMarketplaceOptions {
  rootDir: string
  indexUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxDownloadBytes?: number
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function parseRepo(repoUrl: string | undefined): { owner: string; repo: string } | undefined {
  if (!repoUrl) return undefined
  let parsed: URL
  try {
    parsed = new URL(repoUrl.replace(/^git\+/, ''))
  } catch {
    return undefined
  }
  if (parsed.hostname !== 'github.com') return undefined
  const [owner, repo] = parsed.pathname.replace(/^\//, '').split('/')
  if (!owner || !repo) return undefined
  return { owner, repo: repo.replace(/\.git$/, '') }
}

function downloadCandidates(entry: PluginMarketEntry): string[] {
  const candidates = [entry.downloadUrl]
  const repo = parseRepo(entry.repo)
  if (repo && entry.commit) {
    candidates.push(
      `https://github.com/${repo.owner}/${repo.repo}/archive/${entry.commit}.tar.gz`,
      `https://api.github.com/repos/${repo.owner}/${repo.repo}/tarball/${entry.commit}`
    )
  }
  return candidates.filter((url, index) => candidates.indexOf(url) === index)
}

function isWithinDir(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function isSafeArchivePath(entryPath: string): boolean {
  if (path.isAbsolute(entryPath)) return false
  return !entryPath.split(/[\\/]/).some((segment) => segment === '..')
}

function isFileOrDirectory(entry: ReadEntry | Stats): boolean {
  if ('type' in entry) return entry.type === 'File' || entry.type === 'Directory'
  return entry.isFile() || entry.isDirectory()
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

function verifySha256(data: Buffer, expected: string): void {
  const normalized = expected.trim().replace(/^sha256-/, '')
  const actualHex = createHash('sha256').update(data).digest('hex')

  if (/^[a-f0-9]{64}$/i.test(normalized)) {
    if (normalized.toLowerCase() !== actualHex) throw new Error('sha256 校验失败')
    return
  }

  const decoded = Buffer.from(normalized, 'base64')
  if (decoded.length !== 32) throw new Error('sha256 格式不合法')
  if (decoded.toString('hex') !== actualHex) throw new Error('sha256 校验失败')
}

export class PluginMarketplace {
  private readonly rootDir: string
  private readonly indexUrls: string[]
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly maxDownloadBytes: number

  constructor(options: PluginMarketplaceOptions) {
    this.rootDir = options.rootDir
    const explicitIndexUrl =
      options.indexUrl?.trim() || process.env['ARQQBOT_PLUGIN_INDEX_URL']?.trim()
    this.indexUrls = explicitIndexUrl ? [explicitIndexUrl] : [...DEFAULT_INDEX_URLS]
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxDownloadBytes = options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES
  }

  async fetchIndex(indexUrl?: string): Promise<PluginMarketSnapshot> {
    const explicitIndexUrl = indexUrl?.trim()
    const candidates = explicitIndexUrl ? [explicitIndexUrl] : this.indexUrls
    const snapshot: PluginMarketSnapshot = {
      indexUrl: candidates[0] ?? '',
      plugins: [],
      installedIds: []
    }

    try {
      snapshot.installedIds = await this.listInstalled()
    } catch {
      snapshot.installedIds = []
    }

    const attempted: string[] = []
    let lastError = '索引请求失败'
    for (const candidate of candidates) {
      snapshot.indexUrl = candidate
      attempted.push(candidate)

      if (!isHttpUrl(candidate)) {
        lastError = '索引地址必须是 http/https 地址'
        continue
      }

      try {
        const { plugins, generatedAt } = await this.loadIndex(candidate)
        snapshot.plugins = plugins
        if (generatedAt) snapshot.generatedAt = generatedAt
        return snapshot
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
    }

    snapshot.error =
      attempted.length > 1
        ? `${lastError}（已尝试这些索引地址：${attempted.join('、')}）`
        : lastError
    return snapshot
  }

  private async loadIndex(
    indexUrl: string
  ): Promise<{ plugins: PluginMarketEntry[]; generatedAt?: string }> {
    const data = await this.withRequest(async (signal) => {
      const response = await this.fetchImpl(indexUrl, { signal })
      if (!response.ok) throw new Error(`索引请求失败：HTTP ${response.status}`)
      const buffer = await this.readBody(response, MAX_INDEX_BYTES)
      try {
        return JSON.parse(buffer.toString('utf8')) as unknown
      } catch {
        throw new Error('索引 JSON 解析失败')
      }
    })

    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('索引格式不合法：根节点必须是对象')
    }
    const record = data as Record<string, unknown>
    if (record.version !== 1) {
      throw new Error(`索引版本不支持：${String(record.version)}`)
    }
    if (!Array.isArray(record.plugins)) {
      throw new Error('索引格式不合法：plugins 必须是数组')
    }

    const plugins: PluginMarketEntry[] = []
    for (const item of record.plugins) {
      const parsed = pluginMarketEntrySchema.safeParse(item)
      if (parsed.success) plugins.push(parsed.data)
    }

    return {
      plugins,
      generatedAt: typeof record.generatedAt === 'string' ? record.generatedAt : undefined
    }
  }

  async install(entry: PluginMarketEntry): Promise<void> {
    if (!/^[a-z0-9-]+$/.test(entry.id)) throw new Error(`插件 id 不合法：${entry.id}`)
    if (!isHttpUrl(entry.downloadUrl)) throw new Error('downloadUrl 必须是 http/https 地址')

    const targetDir = path.join(this.rootDir, entry.id)
    if (await pathExists(targetDir)) throw new Error(`插件已安装：${entry.id}`)

    await mkdir(this.rootDir, { recursive: true })
    const workDir = await mkdtemp(path.join(tmpdir(), 'arqqbot-plugin-'))
    const archivePath = path.join(workDir, 'plugin.tar.gz')
    const extractDir = path.join(workDir, 'payload')
    let succeeded = false

    try {
      const archive = await this.downloadArchive(entry)
      await writeFile(archivePath, archive)
      await mkdir(extractDir, { recursive: true })
      await extract({
        file: archivePath,
        cwd: extractDir,
        strip: 1,
        filter: (entryPath, entry) =>
          isSafeArchivePath(entryPath) && entry !== undefined && isFileOrDirectory(entry)
      })

      let pkg: unknown
      try {
        pkg = JSON.parse(await readFile(path.join(extractDir, 'package.json'), 'utf8'))
      } catch {
        throw new Error('插件包缺少有效的 package.json')
      }
      const manifest = parsePluginManifest(pkg)
      if (manifest.id !== entry.id) {
        throw new Error(`manifest id 与索引不一致：${manifest.id} != ${entry.id}`)
      }

      const packageRecord = pkg as Record<string, unknown>
      const packageVersion = packageRecord.version
      if (typeof packageVersion !== 'string') throw new Error('插件包缺少 version')
      if (packageVersion !== entry.version) {
        throw new Error(`插件版本与索引不一致：${packageVersion} != ${entry.version}`)
      }

      const mainField = packageRecord.main
      const main = typeof mainField === 'string' && mainField.length > 0 ? mainField : DEFAULT_ENTRY_PATH
      const entryPath = path.resolve(extractDir, main)
      if (!isWithinDir(extractDir, entryPath)) throw new Error(`插件入口路径越界：${main}`)
      const entryStat = await stat(entryPath).catch(() => undefined)
      if (!entryStat?.isFile()) throw new Error(`插件入口不存在：${main}`)

      await cp(extractDir, targetDir, { recursive: true })
      succeeded = true
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
      if (!succeeded) await rm(targetDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async listInstalled(): Promise<string[]> {
    let names: string[]
    try {
      names = await readdir(this.rootDir)
    } catch {
      return []
    }

    const ids: string[] = []
    for (const name of names) {
      try {
        const pkg = JSON.parse(
          await readFile(path.join(this.rootDir, name, 'package.json'), 'utf8')
        ) as { arqqbot?: { id?: unknown } }
        const id = pkg.arqqbot?.id
        if (typeof id === 'string' && id.length > 0) ids.push(id)
      } catch {
        // 跳过无效或不含 manifest 的目录
      }
    }
    return ids.sort()
  }

  private async downloadArchive(entry: PluginMarketEntry): Promise<Buffer> {
    const candidates = downloadCandidates(entry)
    let lastError = '没有可用的下载地址'

    for (const candidate of candidates) {
      try {
        const archive = await this.withRequest(async (signal) => {
          const response = await this.fetchImpl(candidate, { signal })
          if (!response.ok) throw new Error(`插件下载失败：HTTP ${response.status}`)
          return this.readBody(response, this.maxDownloadBytes)
        })
        if (entry.sha256) verifySha256(archive, entry.sha256)
        return archive
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
    }

    throw new Error(`插件下载失败：${lastError}（已尝试 ${candidates.length} 个下载地址）`)
  }

  private async withRequest<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.timeoutMs)

    try {
      return await run(controller.signal)
    } catch (error) {
      if (timedOut) throw new Error(`请求超时（${this.timeoutMs} 毫秒）`)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private async readBody(response: Response, limit: number): Promise<Buffer> {
    const contentLength = response.headers.get('content-length')
    if (contentLength && Number(contentLength) > limit) {
      throw new Error(`下载内容超过限制（${limit} 字节）`)
    }

    const body = response.body
    if (!body) {
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.byteLength > limit) throw new Error(`下载内容超过限制（${limit} 字节）`)
      return buffer
    }

    const reader = body.getReader()
    const chunks: Buffer[] = []
    let total = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > limit) {
          await reader.cancel().catch(() => undefined)
          throw new Error(`下载内容超过限制（${limit} 字节）`)
        }
        chunks.push(Buffer.from(value))
      }
    } finally {
      reader.releaseLock()
    }
    return Buffer.concat(chunks)
  }
}
