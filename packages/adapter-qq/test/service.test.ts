import { Context } from 'cordis'
import { describe, expect, it, vi } from 'vitest'
import type { QQMessage } from '@arqqbot/shared'
import type { SocketLike } from '../src/gateway'
import { createAdapter } from '../src/index'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

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

describe('QQAdapter 服务集成', () => {
  it('连接网关、分发事件并保持旧 send 兼容', async () => {
    const sockets: FakeSocket[] = []
    const fetchImpl = vi.fn(async (url: unknown) => {
      const href = String(url)
      if (href.includes('getAppAccessToken')) {
        return jsonResponse({ access_token: 'token-1', expires_in: 7200 })
      }
      if (href.includes('/gateway')) return jsonResponse({ url: 'ws://fake' })
      if (href.includes('/messages')) return jsonResponse({ id: 'reply-1' })
      return jsonResponse({})
    })

    const ctx = new Context()
    const handle = await createAdapter(ctx, {
      appId: 'app',
      appSecret: 'secret',
      env: 'sandbox',
      intents: ['public_messages'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      }
    })

    const messages: QQMessage[] = []
    ctx.on('qq/message', (message) => messages.push(message))

    const connecting = handle.connect()
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    const socket = sockets[0]!

    socket.emit('open')
    socket.emit('message', JSON.stringify({ op: 10, d: { heartbeat_interval: 1000 } }))
    await Promise.resolve()
    await Promise.resolve()

    const identify = JSON.parse(socket.sent[0]!)
    expect(identify).toMatchObject({ op: 2, d: { intents: 1 << 25 } })

    socket.emit('message', JSON.stringify({ op: 0, t: 'READY', d: { session_id: 'sess-1' } }))
    await connecting

    socket.emit(
      'message',
      JSON.stringify({
        op: 0,
        s: 2,
        t: 'GROUP_AT_MESSAGE_CREATE',
        d: {
          id: 'msg-1',
          group_openid: 'group-1',
          content: 'hi',
          author: { member_openid: 'member-1' }
        }
      })
    )

    await Promise.resolve()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ scene: 'group', groupId: 'group-1' })

    const result = await handle.service!.send({
      scene: 'group',
      targetId: 'group-1',
      content: 'pong',
      msgId: 'msg-1'
    })
    expect(result.messageId).toBe('reply-1')

    await handle.disconnect()
    expect(socket.closed).toBe(true)
  })
})
