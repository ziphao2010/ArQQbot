import { Context, Service } from 'cordis'
import { describe, expect, it } from 'vitest'
import type { QQMessage, QQSendInput, QQStats } from '@arqqbot/shared'
import * as Echo from '../src/index'

class FakeQQ extends Service {
  sent: QQSendInput[] = []

  constructor(ctx: Context) {
    super(ctx, 'qq')
  }

  async send(input: QQSendInput): Promise<{}> {
    this.sent.push(input)
    return {}
  }

  getStats(): QQStats {
    return { connected: true, received: 0, sent: this.sent.length }
  }
}

const message: QQMessage = {
  id: 'msg-1',
  scene: 'group',
  userId: 'member-1',
  groupId: 'group-1',
  content: '你好',
  mentions: [],
  attachments: [],
  timestamp: '2026-10-31T10:00:00+08:00',
  raw: {}
}

describe('echo plugin', () => {
  it('收到群消息后回复并携带 msgId', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeQQ)
    await ctx.plugin(Echo, { prefix: '收到：' })

    ctx.emit('qq/message', message)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const qq = ctx.qq as unknown as FakeQQ
    expect(qq.sent).toEqual([
      {
        scene: 'group',
        targetId: 'group-1',
        content: '收到：你好',
        msgId: 'msg-1'
      }
    ])
  })

  it('单聊消息使用 userId 作为目标', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeQQ)
    await ctx.plugin(Echo, { prefix: '' })

    ctx.emit('qq/message', { ...message, scene: 'c2c', groupId: undefined, userId: 'user-1' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const qq = ctx.qq as unknown as FakeQQ
    expect(qq.sent[0]).toMatchObject({ scene: 'c2c', targetId: 'user-1', content: '你好' })
  })
})
