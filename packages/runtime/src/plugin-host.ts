import type { Context } from 'cordis'
import { pathToFileURL } from 'node:url'
import type {
  PluginCatalogItem,
  PluginRecord,
  PluginRuntimeState
} from '@arqqbot/shared'

type DisposableFork = { dispose(): void }
export type ModuleLoader = (entryPath: string) => Promise<unknown>

export interface PluginHostOptions {
  ctx: Context
  catalog: Map<string, PluginCatalogItem>
  records: PluginRecord[]
  loadModule?: ModuleLoader
  onState?: (pluginId: string, state: PluginRuntimeState, error?: string) => void
  mountTimeoutMs?: number
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function resolvePlugin(module: unknown): unknown {
  if (typeof module === 'function') return module
  if (module && typeof module === 'object') {
    const record = module as Record<string, unknown>
    if (record.default) return record.default
    if (typeof record.apply === 'function') return module
  }
  throw new Error('插件入口必须导出 Cordis 插件')
}

export class PluginHost {
  private readonly ctx: Context
  private readonly catalog: Map<string, PluginCatalogItem>
  private readonly records: Map<string, PluginRecord>
  private readonly loadModule: ModuleLoader
  private readonly onState?: (pluginId: string, state: PluginRuntimeState, error?: string) => void
  private readonly mountTimeoutMs: number
  private readonly forks = new Map<string, DisposableFork>()
  private readonly states = new Map<string, PluginRuntimeState>()
  private readonly errors = new Map<string, string>()

  constructor(options: PluginHostOptions) {
    this.ctx = options.ctx
    this.catalog = options.catalog
    this.records = new Map(options.records.map((record) => [record.id, { ...record }]))
    this.loadModule = options.loadModule ?? (async (entryPath) => import(pathToFileURL(entryPath).href))
    this.onState = options.onState
    this.mountTimeoutMs = options.mountTimeoutMs ?? 5000
  }

  getState(pluginId: string): PluginRuntimeState | undefined {
    return this.states.get(pluginId)
  }

  getError(pluginId: string): string | undefined {
    return this.errors.get(pluginId)
  }

  getRecord(pluginId: string): PluginRecord | undefined {
    return this.records.get(pluginId)
  }

  private setState(pluginId: string, state: PluginRuntimeState, error?: string): void {
    this.states.set(pluginId, state)
    if (error === undefined) this.errors.delete(pluginId)
    else this.errors.set(pluginId, error)
    this.onState?.(pluginId, state, error)
  }

  private async mount(record: PluginRecord): Promise<void> {
    const catalogItem = this.catalog.get(record.id)
    if (!catalogItem) {
      const message = `未找到插件：${record.id}`
      this.setState(record.id, 'error', message)
      throw new Error(message)
    }

    this.setState(record.id, 'activating')
    let fork: DisposableFork | undefined
    try {
      const module = await withTimeout(
        this.loadModule(catalogItem.entryPath),
        this.mountTimeoutMs,
        `插件挂载超时：${record.id}`
      )
      const plugin = resolvePlugin(module)
      fork = this.ctx.plugin(plugin as never, record.config as never) as unknown as DisposableFork
      await withTimeout(Promise.resolve(fork), this.mountTimeoutMs, `插件挂载超时：${record.id}`)
      this.forks.set(record.id, fork)
      this.setState(record.id, 'active')
    } catch (error) {
      fork?.dispose()
      const message = error instanceof Error ? error.message : String(error)
      this.setState(record.id, 'error', message)
      throw error
    }
  }

  async mountAll(): Promise<void> {
    for (const record of this.records.values()) {
      if (!record.enabled) {
        this.setState(record.id, 'disabled')
        continue
      }
      try {
        await this.mount(record)
      } catch {
        // 单个插件失败不阻断其他插件，错误已记录在状态中
      }
    }
  }

  async applyConfig(pluginId: string, config: Record<string, unknown>): Promise<void> {
    const record = this.records.get(pluginId)
    if (!record) throw new Error(`未找到插件：${pluginId}`)

    const previous = record.config
    if (!record.enabled) {
      record.config = config
      return
    }

    const fork = this.forks.get(pluginId)
    await fork?.dispose()
    this.forks.delete(pluginId)
    record.config = config

    try {
      await this.mount(record)
    } catch (error) {
      record.config = previous
      try {
        await this.mount(record)
      } catch {
        // 回滚也失败时保留 error 状态
      }
      const message = error instanceof Error ? error.message : String(error)
      this.setState(pluginId, 'error', message)
      throw error
    }
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<void> {
    const record = this.records.get(pluginId)
    if (!record) throw new Error(`未找到插件：${pluginId}`)
    if (record.enabled === enabled) return

    if (!enabled) {
      const fork = this.forks.get(pluginId)
      await fork?.dispose()
      this.forks.delete(pluginId)
      record.enabled = false
      this.setState(pluginId, 'disabled')
      return
    }

    record.enabled = true
    try {
      await this.mount(record)
    } catch (error) {
      record.enabled = false
      throw error
    }
  }

  async disposeAll(): Promise<void> {
    for (const fork of this.forks.values()) await fork.dispose()
    this.forks.clear()
  }
}
