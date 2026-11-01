import type {
  InstanceStatus,
  LogEntry,
  PluginRuntimeState,
  QQCapabilityInfo,
  WorkerEvent,
  WorkerRequest,
  WorkerStartConfig
} from '@arqqbot/shared'

export interface WorkerProcessLike {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: unknown) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  kill(): void
}

export interface WorkerFactory {
  spawn(): WorkerProcessLike
}

export interface SupervisorCallbacks {
  onLog(entry: LogEntry): void
  onStatus(status: InstanceStatus): void
  onPluginState(pluginId: string, state: PluginRuntimeState, error?: string): void
  onExit(code: number, expected: boolean): void
}

interface PendingRequest {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

export class WorkerSupervisor {
  private process?: WorkerProcessLike
  private readonly pending = new Map<string, PendingRequest>()
  private requestCounter = 0
  private stopping = false
  private lastStatus?: InstanceStatus

  constructor(
    private readonly factory: WorkerFactory,
    private readonly callbacks: SupervisorCallbacks
  ) {}

  private nextId(): string {
    this.requestCounter += 1
    return String(this.requestCounter)
  }

  private async open(): Promise<void> {
    const child = this.factory.spawn()
    this.process = child
    child.on('message', (message) => this.handleMessage(message as WorkerEvent))
    child.on('exit', (code) => this.handleExit(code))
  }

  private request(request: WorkerRequest, timeoutMs = 10_000): Promise<unknown> {
    const child = this.process
    if (!child) return Promise.reject(new Error('Worker 未启动'))

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.requestId)
        reject(new Error('Worker 响应超时'))
      }, timeoutMs)
      this.pending.set(request.requestId, { resolve, reject, timer })
      child.postMessage(request)
    })
  }

  async start(config: WorkerStartConfig): Promise<void> {
    await this.open()
    await this.request({ type: 'start', requestId: this.nextId(), config })
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (!this.process) return
    try {
      await this.request({ type: 'stop', requestId: this.nextId() }, 5000)
    } catch {
      this.process.kill()
    }
  }

  async applyPluginConfig(pluginId: string, config: Record<string, unknown>): Promise<void> {
    await this.request({
      type: 'applyPluginConfig',
      requestId: this.nextId(),
      pluginId,
      config
    })
  }

  async setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
    await this.request({
      type: 'setPluginEnabled',
      requestId: this.nextId(),
      pluginId,
      enabled
    })
  }

  async getStatus(): Promise<InstanceStatus> {
    await this.request({ type: 'getStatus', requestId: this.nextId() })
    if (!this.lastStatus) throw new Error('Worker 未上报状态')
    return this.lastStatus
  }

  async getCapabilities(): Promise<QQCapabilityInfo[]> {
    const result = await this.request({ type: 'getCapabilities', requestId: this.nextId() })
    return Array.isArray(result) ? (result as QQCapabilityInfo[]) : []
  }

  dispose(): void {
    this.process?.kill()
    this.process = undefined
  }

  private handleMessage(event: WorkerEvent): void {
    if (event.type === 'response') {
      const pending = this.pending.get(event.requestId)
      if (!pending) return
      this.pending.delete(event.requestId)
      clearTimeout(pending.timer)
      if (event.ok) pending.resolve(event.result)
      else pending.reject(Object.assign(new Error(event.error.message), { code: event.error.code }))
      return
    }

    if (event.type === 'log') {
      this.callbacks.onLog(event.entry)
      return
    }

    if (event.type === 'status') {
      this.lastStatus = event.status
      this.callbacks.onStatus(event.status)
      return
    }

    if (event.type === 'pluginState') {
      this.callbacks.onPluginState(event.pluginId, event.state, event.error)
    }
  }

  private handleExit(code: number): void {
    const expected = this.stopping
    this.process = undefined
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error(`Worker 已退出，请求未完成：${requestId}`))
    }
    this.pending.clear()
    this.callbacks.onExit(code, expected)
  }
}
