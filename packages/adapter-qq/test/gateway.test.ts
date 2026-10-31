import { afterEach, describe, expect, it, vi } from 'vitest'
import { GatewayClient, type SocketLike } from '../src/gateway'

class FakeSocket implements SocketLike {
  private handlers = new Map<string, (...args: any[]) => void>()
  sent: string[] = []
  closed = false

  on(event: string, listener: (...args: any[]) => void): void {
    this.handlers.set(event, listener)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
    this.emit('close', 4000)
  }

  emit(event: string, ...args: any[]): void {
    this.handlers.get(event)?.(...args)
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('GatewayClient', () => {
  it('完成 Hello、Identify、READY 并分发事件', async () => {
    vi.useFakeTimers()
    const socket = new FakeSocket()
    const onDispatch = vi.fn()
    const onReady = vi.fn()
    const onError = vi.fn()
    const client = new GatewayClient({
      url: 'ws://fake',
      getToken: async () => 'token-1',
      intents: 1 << 25,
      handlers: { onDispatch, onReady, onError },
      socketFactory: () => socket,
      reconnectBaseMs: 10,
      reconnectMaxMs: 20
    })

    const ready = client.connect()
    socket.emit('open')
    socket.emit('message', JSON.stringify({ op: 10, d: { heartbeat_interval: 1000 } }))
    await Promise.resolve()
    await Promise.resolve()

    expect(JSON.parse(socket.sent[0]!)).toMatchObject({
      op: 2,
      d: { token: 'QQBot token-1', intents: 1 << 25, shard: [0, 1] }
    })

    socket.emit('message', JSON.stringify({ op: 0, s: 1, t: 'READY', d: { session_id: 'sess-1' } }))
    await ready
    expect(client.connected).toBe(true)
    expect(onReady).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1000)
    expect(JSON.parse(socket.sent[1]!)).toMatchObject({ op: 1, d: 1 })

    socket.emit('message', JSON.stringify({ op: 0, s: 2, t: 'GROUP_AT_MESSAGE_CREATE', d: { id: 'm-1' } }))
    expect(onDispatch).toHaveBeenCalledWith('GROUP_AT_MESSAGE_CREATE', { id: 'm-1' })

    client.close()
    expect(socket.closed).toBe(true)
  })

  it('READY 前断开时拒绝 connect', async () => {
    const socket = new FakeSocket()
    const client = new GatewayClient({
      url: 'ws://fake',
      getToken: async () => 'token-1',
      intents: 1 << 25,
      handlers: { onDispatch: vi.fn(), onReady: vi.fn(), onError: vi.fn() },
      socketFactory: () => socket
    })

    const ready = client.connect()
    socket.emit('open')
    socket.emit('close', 4914)
    await expect(ready).rejects.toThrow('网关在 READY 前断开')
  })
})
