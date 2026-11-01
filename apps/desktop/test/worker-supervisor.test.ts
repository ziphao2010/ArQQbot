import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkerRequest, WorkerStartConfig } from '@arqqbot/shared'
import { WorkerSupervisor, type WorkerProcessLike } from '@arqqbot/control'

class FakeWorker implements WorkerProcessLike {
  private handlers = new Map<string, (...args: any[]) => void>()
  sent: WorkerRequest[] = []

  postMessage(message: unknown): void {
    this.sent.push(message as WorkerRequest)
  }

  on(event: 'message' | 'exit', listener: (...args: any[]) => void): void {
    this.handlers.set(event, listener)
  }

  kill(): void {
    this.emit('exit', 1)
  }

  emit(event: string, ...args: any[]): void {
    this.handlers.get(event)?.(...args)
  }
}

const config: WorkerStartConfig = {
  instanceId: 'inst-1',
  appId: 'app',
  appSecret: 'secret',
  env: 'sandbox',
  dataDir: 'C:/temp/arqqbot-data',
  catalog: [],
  plugins: []
}

afterEach(() => {
  vi.useRealTimers()
})

describe('WorkerSupervisor', () => {
  it('发送 start 请求并处理响应、日志、状态与退出', async () => {
    const worker = new FakeWorker()
    const events: string[] = []
    const supervisor = new WorkerSupervisor({ spawn: () => worker }, {
      onLog: () => events.push('log'),
      onStatus: () => events.push('status'),
      onPluginState: () => events.push('plugin'),
      onExit: (code) => events.push(`exit:${code}`)
    })

    const starting = supervisor.start(config)
    await Promise.resolve()
    expect(worker.sent[0]).toMatchObject({ type: 'start', requestId: '1', config })
    worker.emit('message', { type: 'response', requestId: '1', ok: true })
    await starting

    worker.emit('message', { type: 'log', entry: { time: 'x', level: 'info', message: 'hi' } })
    worker.emit('message', {
      type: 'status',
      status: { id: 'inst-1', state: 'running', connected: true, sent: 0, received: 0 }
    })
    worker.emit('message', { type: 'pluginState', pluginId: 'echo', state: 'active' })
    worker.emit('exit', 0)

    expect(events).toEqual(['log', 'status', 'plugin', 'exit:0'])
    expect(await supervisor.getStatus().catch(() => undefined)).toBeUndefined()
  })

  it('获取能力列表', async () => {
    const worker = new FakeWorker()
    const supervisor = new WorkerSupervisor({ spawn: () => worker }, {
      onLog: vi.fn(),
      onStatus: vi.fn(),
      onPluginState: vi.fn(),
      onExit: vi.fn()
    })

    const starting = supervisor.start(config)
    await Promise.resolve()
    worker.emit('message', { type: 'response', requestId: '1', ok: true })
    await starting

    const pending = supervisor.getCapabilities()
    await Promise.resolve()
    expect(worker.sent[1]).toMatchObject({ type: 'getCapabilities', requestId: '2' })
    worker.emit('message', {
      type: 'response',
      requestId: '2',
      ok: true,
      result: [{ id: 'message.send', module: 'message', available: true }]
    })

    await expect(pending).resolves.toEqual([
      { id: 'message.send', module: 'message', available: true }
    ])
  })

  it('Worker 无响应时请求超时', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const supervisor = new WorkerSupervisor({ spawn: () => worker }, {
      onLog: vi.fn(),
      onStatus: vi.fn(),
      onPluginState: vi.fn(),
      onExit: vi.fn()
    })

    const starting = supervisor.start(config)
    const expectation = expect(starting).rejects.toThrow('Worker 响应超时')
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(10_000)
    await expectation
  })
})
