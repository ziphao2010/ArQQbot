import { describe, expect, it, vi } from 'vitest'
import { QQSender } from '../src/sender'
import { TokenManager } from '../src/token'

function makeSender(fetchImpl: ReturnType<typeof vi.fn>, now = () => 0): QQSender {
  const token = new TokenManager({
    appId: 'app',
    appSecret: 'secret',
    fetchImpl: vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'token-1', expires_in: 7200 }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    ) as unknown as typeof fetch
  })
  return new QQSender({
    token,
    baseUrl: 'https://api.test',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    now
  })
}

describe('QQSender', () => {
  it('发送群聊被动回复并携带 msg_id 与 msg_seq', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'reply-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    const sender = makeSender(fetchImpl)

    const result = await sender.send({
      scene: 'group',
      targetId: 'group-1',
      content: '你好',
      msgId: 'msg-1'
    })

    expect(result.messageId).toBe('reply-1')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/v2/groups/group-1/messages',
      expect.objectContaining({ method: 'POST' })
    )
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toMatchObject({
      content: '你好',
      msg_type: 0,
      msg_id: 'msg-1',
      msg_seq: 1
    })
  })

  it('拒绝主动消息', async () => {
    const sender = makeSender(vi.fn())
    await expect(
      sender.send({ scene: 'group', targetId: 'group-1', content: 'x' })
    ).rejects.toMatchObject({ code: 'ACTIVE_MESSAGE_UNSUPPORTED' })
  })

  it('超出被动回复配额抛出 QUOTA_EXCEEDED', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'reply' }), { status: 200 })
    )
    const sender = makeSender(fetchImpl)

    for (let index = 0; index < 5; index += 1) {
      await sender.send({ scene: 'group', targetId: 'group-1', content: 'x', msgId: 'msg-1' })
    }
    await expect(
      sender.send({ scene: 'group', targetId: 'group-1', content: 'x', msgId: 'msg-1' })
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' })
  })

  it('长文本分段发送且每段递增 msg_seq', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'reply' }), { status: 200 })
    )
    const sender = new QQSender({
      token: new TokenManager({
        appId: 'app',
        appSecret: 'secret',
        fetchImpl: vi.fn(async () =>
          new Response(JSON.stringify({ access_token: 'token-1', expires_in: 7200 }), {
            status: 200
          })
        ) as unknown as typeof fetch
      }),
      baseUrl: 'https://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxTextLength: 3
    })

    await sender.send({
      scene: 'group',
      targetId: 'group-1',
      content: 'abcdefg',
      msgId: 'msg-1'
    })

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    const bodies = fetchImpl.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)))
    expect(bodies.map((body) => body.msg_seq)).toEqual([1, 2, 3])
    expect(bodies.map((body) => body.content)).toEqual(['abc', 'def', 'g'])
  })
})
