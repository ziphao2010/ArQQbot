import { Context } from 'cordis'
import path from 'node:path'
import type {
  InstanceStatus,
  PluginRuntimeState,
  QQIntentName,
  WorkerStartConfig
} from '@arqqbot/shared'
import { createAdapter, type AdapterHandle } from '@arqqbot/adapter-qq'
import { StorageService } from './services/storage'
import { PluginHost, type ModuleLoader } from './plugin-host'

export interface BootstrapBridge {
  post(event: unknown): void
}

export interface BootstrapDeps {
  createAdapter?: (ctx: Context, config: {
    appId: string
    appSecret: string
    env: WorkerStartConfig['env']
    intents?: QQIntentName[]
  }) => Promise<AdapterHandle>
  loadModule?: ModuleLoader
}

export interface BootstrapResult {
  ctx: Context
  host: PluginHost
  adapter: AdapterHandle
  getStatus(): InstanceStatus
  stop(): Promise<void>
}

export async function bootstrapInstance(
  config: WorkerStartConfig,
  bridge: BootstrapBridge,
  deps: BootstrapDeps = {}
): Promise<BootstrapResult> {
  const ctx = new Context()
  const forks: Array<{ dispose(): void }> = []
  const startedAt = new Date().toISOString()

  interface LoggerExporter {
    export(message: {
      ts: number
      type: 'error' | 'info' | 'warn' | 'debug'
      name?: string
      args: unknown[]
    }): void
  }

  const loggerService = ctx.logger as unknown as {
    exporter(exporter: LoggerExporter): () => void
  }
  const stopLogger = loggerService.exporter({
    export(message) {
      bridge.post({
        type: 'log',
        entry: {
          time: new Date(message.ts).toISOString(),
          level: message.type,
          message: message.args.map((arg) => String(arg)).join(' '),
          ...(message.name ? { pluginId: message.name } : {})
        }
      })
    }
  })
  ctx.logger.info('实例开始启动')

  forks.push(await ctx.plugin(StorageService, {
    dir: path.join(config.dataDir, 'storage')
  }))

  const adapterConfig = {
    appId: config.appId,
    appSecret: config.appSecret,
    env: config.env,
    intents: config.intents
  }

  const adapter = deps.createAdapter
    ? await deps.createAdapter(ctx, adapterConfig)
    : await createAdapter(ctx, adapterConfig)

  await adapter.connect()

  const catalog = new Map(config.catalog.map((item) => [item.manifest.id, item]))
  const records = config.catalog.map((item) => {
    const existing = config.plugins.find((record) => record.id === item.manifest.id)
    return existing ?? { id: item.manifest.id, enabled: false, config: item.manifest.defaultConfig }
  })
  for (const record of config.plugins) {
    if (!catalog.has(record.id)) records.push(record)
  }

  const host = new PluginHost({
    ctx,
    catalog,
    records,
    loadModule: deps.loadModule,
    onState: (pluginId: string, state: PluginRuntimeState, error?: string) => {
      bridge.post({ type: 'pluginState', pluginId, state, error })
    }
  })
  await host.mountAll()

  let state: InstanceStatus['state'] = 'running'
  let lastError: InstanceStatus['lastError']

  const getStatus = (): InstanceStatus => {
    const stats = adapter.service?.getStats() ?? {
      connected: false,
      received: 0,
      sent: 0
    }
    return {
      id: config.instanceId,
      state,
      connected: stats.connected,
      startedAt,
      sent: stats.sent,
      received: stats.received,
      ...(lastError ? { lastError } : {})
    }
  }

  const statusTimer = setInterval(() => {
    bridge.post({ type: 'status', status: getStatus() })
  }, 5000)

  return {
    ctx,
    host,
    adapter,
    getStatus,
    async stop() {
      state = 'stopping'
      clearInterval(statusTimer)
      await host.disposeAll()
      await adapter.disconnect()
      stopLogger()
      for (const fork of forks) await fork.dispose()
      state = 'stopped'
    }
  }
}
