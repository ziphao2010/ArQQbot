import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type {
  CreateInstanceInput,
  InstanceRecord,
  InstanceRuntimeState,
  InstanceStatus,
  InstanceSummary,
  LogEntry,
  PluginCatalogItem,
  PluginRecord,
  PluginRuntimeState,
  PluginSummary,
  QQCapabilitySnapshot,
  QQIntentName,
  UpdateInstanceInput
} from '@arqqbot/shared'
import { scanPluginCatalog } from '@arqqbot/shared/node'
import { validatePluginConfig } from '@arqqbot/shared'
import { InstanceStore } from './instance-store'
import {
  decryptSecrets,
  encryptSecrets,
  mergeSecretInput,
  maskSecrets,
  redact,
  type SecretCodec
} from './secrets'
import { WorkerSupervisor, type WorkerFactory } from './worker-supervisor'

export interface InstanceManagerOptions {
  rootDir: string
  builtinPluginRoot: string
  externalPluginRoot: string
  workerFactory: WorkerFactory
  secretCodec: SecretCodec
}

interface PluginRuntimeInfo {
  state: PluginRuntimeState
  error?: string
}

export class InstanceManager {
  readonly store: InstanceStore
  private readonly states = new Map<string, InstanceRuntimeState>()
  private readonly lastStatus = new Map<string, InstanceStatus>()
  private readonly pluginStates = new Map<string, Map<string, PluginRuntimeInfo>>()
  private readonly supervisors = new Map<string, WorkerSupervisor>()
  private readonly logListeners = new Map<string, Set<(entry: LogEntry) => void>>()
  private readonly requiresRestart = new Set<string>()
  private readonly failedStarts = new Set<string>()

  constructor(private readonly options: InstanceManagerOptions) {
    this.store = new InstanceStore(options.rootDir)
  }

  async init(): Promise<void> {
    await this.store.init()
    await mkdir(this.options.externalPluginRoot, { recursive: true })
  }

  private stateOf(id: string): InstanceRuntimeState {
    return this.states.get(id) ?? 'stopped'
  }

  private summary(record: InstanceRecord): InstanceSummary {
    return {
      id: record.id,
      name: record.name,
      appId: record.appId,
      env: record.env,
      intents: record.intents,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      state: this.stateOf(record.id),
      requiresRestart: this.requiresRestart.has(record.id)
    }
  }

  async list(): Promise<InstanceSummary[]> {
    const records = await this.store.list()
    return records.map((record) => this.summary(record))
  }

  async create(input: CreateInstanceInput): Promise<InstanceSummary> {
    const record = await this.store.create({
      name: input.name,
      appId: input.appId,
      secretRef: this.options.secretCodec.encrypt(input.appSecret),
      env: input.env,
      intents: input.intents
    })
    this.states.set(record.id, 'stopped')
    return this.summary(record)
  }

  async update(id: string, input: UpdateInstanceInput): Promise<InstanceSummary> {
    const patch: Partial<
      Pick<InstanceRecord, 'name' | 'appId' | 'secretRef' | 'env' | 'intents'>
    > = {}
    if (input.name !== undefined) patch.name = input.name
    if (input.appId !== undefined) patch.appId = input.appId
    if (input.env !== undefined) patch.env = input.env
    if (input.intents !== undefined) patch.intents = input.intents
    if (input.appSecret !== undefined) patch.secretRef = this.options.secretCodec.encrypt(input.appSecret)

    const record = await this.store.update(id, patch)
    if (
      input.appId !== undefined ||
      input.env !== undefined ||
      input.appSecret !== undefined ||
      input.intents !== undefined
    ) {
      this.requiresRestart.add(id)
    }
    return this.summary(record)
  }

  async remove(id: string): Promise<void> {
    await this.stop(id)
    await this.store.remove(id)
    this.states.delete(id)
    this.lastStatus.delete(id)
    this.pluginStates.delete(id)
    this.requiresRestart.delete(id)
    this.logListeners.delete(id)
  }

  private async scanCatalog(): Promise<PluginCatalogItem[]> {
    const result = await scanPluginCatalog([
      { path: this.options.builtinPluginRoot, source: 'builtin' },
      { path: this.options.externalPluginRoot, source: 'external' }
    ])
    return result.items
  }

  async start(id: string): Promise<void> {
    const record = await this.store.get(id)
    if (!record) throw new Error(`实例不存在：${id}`)
    if (this.supervisors.has(id)) return

    this.states.set(id, 'starting')
    this.pluginStates.delete(id)
    this.failedStarts.delete(id)
    const catalog = await this.scanCatalog()
    const savedPlugins = await this.store.readPlugins(id)
    const plugins = savedPlugins.map((record) => {
      const item = catalog.find((entry) => entry.manifest.id === record.id)
      return item
        ? {
            ...record,
            config: decryptSecrets(item.manifest.schema, record.config, this.options.secretCodec)
          }
        : { ...record }
    })
    const supervisor = new WorkerSupervisor(this.options.workerFactory, {
      onLog: (entry) => this.handleLog(id, entry),
      onStatus: (status) => this.handleStatus(status),
      onPluginState: (pluginId, state, error) => this.handlePluginState(id, pluginId, state, error),
      onExit: (code, expected) => this.handleExit(id, code, expected)
    })
    this.supervisors.set(id, supervisor)

    try {
      await supervisor.start({
        instanceId: id,
        appId: record.appId,
        appSecret: this.options.secretCodec.decrypt(record.secretRef),
        env: record.env,
        intents: record.intents,
        dataDir: path.join(this.options.rootDir, 'instances', id, 'data'),
        catalog,
        plugins
      })
      this.states.set(id, 'running')
      this.requiresRestart.delete(id)
    } catch (error) {
      this.supervisors.delete(id)
      this.failedStarts.add(id)
      supervisor.dispose()
      this.states.set(id, 'error')
      const message = error instanceof Error ? error.message : String(error)
      this.lastStatus.set(id, {
        id,
        state: 'error',
        connected: false,
        sent: 0,
        received: 0,
        lastError: { code: 'START_FAILED', message }
      })
      throw error
    }
  }

  async stop(id: string): Promise<void> {
    const supervisor = this.supervisors.get(id)
    if (!supervisor) {
      this.states.set(id, 'stopped')
      return
    }
    this.states.set(id, 'stopping')
    try {
      await supervisor.stop()
    } finally {
      this.supervisors.delete(id)
      this.states.set(id, 'stopped')
    }
  }

  async restart(id: string): Promise<void> {
    await this.stop(id)
    await this.start(id)
  }

  async status(id: string): Promise<InstanceStatus> {
    const status = this.lastStatus.get(id)
    if (status) return { ...status, state: this.stateOf(id) }
    return {
      id,
      state: this.stateOf(id),
      connected: false,
      sent: 0,
      received: 0
    }
  }

  async updateIntents(id: string, intents: QQIntentName[]): Promise<void> {
    await this.store.update(id, { intents })
    this.requiresRestart.add(id)
  }

  async capabilities(id: string): Promise<QQCapabilitySnapshot> {
    const record = await this.store.get(id)
    if (!record) throw new Error(`实例不存在：${id}`)

    const supervisor = this.supervisors.get(id)
    if (!supervisor) {
      return {
        instanceId: id,
        intents: record.intents,
        capabilities: [],
        running: false,
        reason: '实例未运行，启动后可查看能力状态'
      }
    }

    try {
      return {
        instanceId: id,
        intents: record.intents,
        capabilities: await supervisor.getCapabilities(),
        running: this.stateOf(id) === 'running'
      }
    } catch (error) {
      return {
        instanceId: id,
        intents: record.intents,
        capabilities: [],
        running: this.stateOf(id) === 'running',
        reason: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async listPlugins(instanceId: string): Promise<PluginSummary[]> {
    const catalog = await this.scanCatalog()
    const records = await this.store.readPlugins(instanceId)
    const recordMap = new Map(records.map((record) => [record.id, record]))
    const runtime = this.pluginStates.get(instanceId)
    const result: PluginSummary[] = []

    for (const item of catalog) {
      const manifest = item.manifest
      const record = recordMap.get(manifest.id)
      const decrypted = record
        ? decryptSecrets(manifest.schema, record.config, this.options.secretCodec)
        : {}
      const runtimeInfo = runtime?.get(manifest.id)
      const runtimeState: PluginRuntimeState =
        runtimeInfo?.state ?? (record?.enabled ? 'enabled' : 'disabled')
      const summary: PluginSummary = {
        id: manifest.id,
        displayName: manifest.displayName,
        description: manifest.description,
        version: manifest.version,
        enabled: record?.enabled ?? false,
        runtimeState,
        schema: manifest.schema,
        config: maskSecrets(manifest.schema, decrypted),
        defaultConfig: manifest.defaultConfig
      }
      if (runtimeInfo?.error) summary.error = runtimeInfo.error
      result.push(summary)
    }

    return result
  }

  async updatePluginConfig(
    instanceId: string,
    pluginId: string,
    input: Record<string, unknown>
  ): Promise<void> {
    const catalog = await this.scanCatalog()
    const item = catalog.find((entry) => entry.manifest.id === pluginId)
    if (!item) throw new Error(`插件不存在：${pluginId}`)

    const records = await this.store.readPlugins(instanceId)
    const record = records.find((entry) => entry.id === pluginId)
    const existingEncrypted = record?.config ?? item.manifest.defaultConfig
    const existingDecrypted = decryptSecrets(item.manifest.schema, existingEncrypted, this.options.secretCodec)
    const merged = mergeSecretInput(item.manifest.schema, input, existingDecrypted)
    const validation = validatePluginConfig(item.manifest, merged)
    if (!validation.ok) {
      const message = validation.errors.map((error) => `${error.path} ${error.message}`).join('; ')
      throw new Error(`配置不合法：${message}`)
    }

    const encrypted = encryptSecrets(item.manifest.schema, validation.value, this.options.secretCodec)
    const nextRecord: PluginRecord = {
      id: pluginId,
      enabled: record?.enabled ?? false,
      config: encrypted
    }
    const nextRecords = record
      ? records.map((entry) => (entry.id === pluginId ? nextRecord : entry))
      : [...records, nextRecord]

    const supervisor = this.supervisors.get(instanceId)
    if (supervisor) {
      await supervisor.applyPluginConfig(pluginId, validation.value)
    }
    await this.store.writePlugins(instanceId, nextRecords)
  }

  async setPluginEnabled(instanceId: string, pluginId: string, enabled: boolean): Promise<void> {
    const catalog = await this.scanCatalog()
    const item = catalog.find((entry) => entry.manifest.id === pluginId)
    if (!item) throw new Error(`插件不存在：${pluginId}`)

    const records = await this.store.readPlugins(instanceId)
    const record = records.find((entry) => entry.id === pluginId)
    const nextRecord: PluginRecord = {
      id: pluginId,
      enabled,
      config: record?.config ?? item.manifest.defaultConfig
    }
    const nextRecords = record
      ? records.map((entry) => (entry.id === pluginId ? nextRecord : entry))
      : [...records, nextRecord]

    const supervisor = this.supervisors.get(instanceId)
    if (supervisor) await supervisor.setPluginEnabled(pluginId, enabled)
    await this.store.writePlugins(instanceId, nextRecords)

    if (!supervisor) {
      const runtime = this.pluginStates.get(instanceId) ?? new Map<string, PluginRuntimeInfo>()
      runtime.set(pluginId, { state: enabled ? 'enabled' : 'disabled' })
      this.pluginStates.set(instanceId, runtime)
    }
  }

  subscribeLogs(instanceId: string, listener: (entry: LogEntry) => void): () => void {
    const listeners = this.logListeners.get(instanceId) ?? new Set()
    listeners.add(listener)
    this.logListeners.set(instanceId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.logListeners.delete(instanceId)
    }
  }

  async shutdown(): Promise<void> {
    for (const supervisor of this.supervisors.values()) {
      await supervisor.stop().catch(() => supervisor.dispose())
    }
    this.supervisors.clear()
  }

  private handleLog(instanceId: string, entry: LogEntry): void {
    const safeEntry: LogEntry = {
      ...entry,
      ...(entry.data !== undefined ? { data: redact(entry.data) } : {})
    }
    const day = safeEntry.time.slice(0, 10)
    const dir = path.join(this.options.rootDir, 'instances', instanceId, 'logs')
    mkdir(dir, { recursive: true })
      .then(() => appendFile(path.join(dir, `${day}.jsonl`), `${JSON.stringify(safeEntry)}\n`, 'utf8'))
      .catch(() => undefined)
    this.logListeners.get(instanceId)?.forEach((listener) => listener(safeEntry))
  }

  private handleStatus(status: InstanceStatus): void {
    this.lastStatus.set(status.id, status)
    if (status.state === 'running' || status.state === 'error' || status.state === 'stopped') {
      this.states.set(status.id, status.state)
    }
  }

  private handlePluginState(
    instanceId: string,
    pluginId: string,
    state: PluginRuntimeState,
    error?: string
  ): void {
    const runtime = this.pluginStates.get(instanceId) ?? new Map<string, PluginRuntimeInfo>()
    runtime.set(pluginId, { state, ...(error ? { error } : {}) })
    this.pluginStates.set(instanceId, runtime)
  }

  private handleExit(instanceId: string, code: number, expected: boolean): void {
    this.supervisors.delete(instanceId)
    this.pluginStates.delete(instanceId)
    if (this.failedStarts.has(instanceId)) {
      this.failedStarts.delete(instanceId)
      return
    }
    const previous = this.lastStatus.get(instanceId)
    const state: InstanceRuntimeState = expected ? 'stopped' : 'crashed'
    this.states.set(instanceId, state)
    this.lastStatus.set(instanceId, {
      id: instanceId,
      state,
      connected: false,
      sent: previous?.sent ?? 0,
      received: previous?.received ?? 0,
      ...(expected
        ? {}
        : {
            lastError: {
              code: 'WORKER_CRASHED',
              message: `Worker 意外退出，退出码 ${code}`
            }
          })
    })
  }
}
