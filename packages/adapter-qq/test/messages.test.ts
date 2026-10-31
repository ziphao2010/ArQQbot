import { describe, expect, it, vi } from 'vitest'
import type { QQMessage } from '@arqqbot/shared'
import { QQCapabilityRegistry } from '../src/core/capability-registry'
import { QQHttpClient } from '../src/core/http-client'
import { QQMessageModule } from '../src/modules/messages'
import { TokenManager } from '../src/token'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function makeModule(
  fetchImpl: ReturnType<typeof vi.fn>,
  options: { maxTextLength?: number } = {}
): QQMessageModule {
  const token = new TokenManager({
    appId: 'app',
    appSecret: 'secret',
    fetchImpl: vi.fn(async () =>
      jsonResponse({ access_token: 'token-1', expires_in: 7200 })
    ) as unknown as typeof fetch
  })
  const http = new QQHttpClient({
    token,
    baseUrls: ['https://api.test'],
    fetchImpl: fetchImpl as unknown as typeof fetch
  })
  const capabilities = new QQCapabilityRegistry({ env: 'production', intents: 0 })
  return new QQMessageModule({ http, capabilities, maxTextLength: options.maxTextLength })
}

describe('QQMessageModule', () => {
  it('发送群聊文本被动回复', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'reply-1' }))
    const messages = makeModule(fetchImpl)

    const result = await messages.send({
      target: { scene: 'group', groupId: 'group-1' },
      content: { type: 'text', text: '你好' },
      replyTo: 'msg-1'
    })

    expect(result.messageId).toBe('reply-1')
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.test/v2/groups/group-1/messages')
    const body = JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit).body))
    expect(body).toMatchObject({
      content: '你好',
      msg_type: 0,
      msg_id: 'msg-1',
      msg_seq: 1
    })
  })

  it('发送 markdown 与 keyboard', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'reply-2' }))
    const messages = makeModule(fetchImpl)

    await messages.send({
      target: { scene: 'c2c', userId: 'user-1' },
      content: {
        type: 'markdown',
        markdown: { content: '# 标题' },
        keyboard: { id: 'keyboard-1' }
      },
      replyTo: 'msg-2'
    })

    const body = JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit).body))
    expect(body).toMatchObject({
      msg_type: 2,
      markdown: { content: '# 标题' },
      keyboard: { id: 'keyboard-1' },
      msg_id: 'msg-2',
      msg_seq: 1
    })
  })

  it('reply 自动递增 msg_seq', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'reply' }))
    const messages = makeModule(fetchImpl)
    const source: QQMessage = {
      id: 'msg-1',
      scene: 'group',
      userId: 'member-1',
      groupId: 'group-1',
      content: 'hi',
      mentions: [],
      attachments: [],
      timestamp: '2026-11-01T10:00:00+08:00',
      raw: {}
    }

    await messages.reply(source, { type: 'text', text: 'a' })
    await messages.reply(source, { type: 'text', text: 'b' })

    const bodies = fetchImpl.mock.calls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body))
    )
    expect(bodies.map((body) => body.msg_seq)).toEqual([1, 2])
  })

  it('撤回群聊消息使用 DELETE 路径', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }))
    const messages = makeModule(fetchImpl)

    await messages.recall('group', 'group-1', 'message-1')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://api.test/v2/groups/group-1/messages/message-1'
    )
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).method).toBe('DELETE')
  })

  it('流式发送累积内容并携带 stream_msg_id', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'stream-1' }))
    const messages = makeModule(fetchImpl)

    const handle = await messages.sendStream({
      target: { scene: 'c2c', userId: 'user-1' },
      replyTo: 'msg-1'
    })

    await handle.write('你')
    await handle.write('好')
    await handle.end()

    const bodies = fetchImpl.mock.calls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body))
    )
    expect(bodies[0]).toMatchObject({
      input_mode: 'replace',
      input_state: 1,
      index: 0,
      content_type: 'markdown',
      content_raw: '你',
      msg_id: 'msg-1',
      msg_seq: 1
    })
    expect(bodies[1]).toMatchObject({
      index: 1,
      content_raw: '你好',
      stream_msg_id: 'stream-1'
    })
    expect(bodies[2]).toMatchObject({
      input_state: 10,
      index: 2,
      content_raw: '你好'
    })
  })

  it('缺少 replyTo/eventId 时拒绝主动消息', async () => {
    const messages = makeModule(vi.fn())

    await expect(
      messages.send({
        target: { scene: 'group', groupId: 'group-1' },
        content: { type: 'text', text: 'x' }
      })
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
  })
})
