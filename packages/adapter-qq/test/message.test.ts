import { describe, expect, it } from 'vitest'
import { MessageDeduper, normalizeQQEvent } from '../src/message'

describe('normalizeQQEvent', () => {
  it('归一化群聊 @ 消息', () => {
    const message = normalizeQQEvent('GROUP_AT_MESSAGE_CREATE', {
      id: 'msg-1',
      group_openid: 'group-1',
      content: ' 你好',
      timestamp: '2026-10-31T10:00:00+08:00',
      author: { member_openid: 'member-1' },
      attachments: [{ content_type: 'image/png', url: 'https://img.test/a.png', filename: 'a.png', size: 100 }]
    })

    expect(message).toMatchObject({
      id: 'msg-1',
      scene: 'group',
      groupId: 'group-1',
      userId: 'member-1',
      content: '你好'
    })
    expect(message?.attachments[0]?.contentType).toBe('image/png')
  })

  it('归一化单聊消息', () => {
    const message = normalizeQQEvent('C2C_MESSAGE_CREATE', {
      id: 'msg-2',
      content: 'hi',
      timestamp: '2026-10-31T10:00:00+08:00',
      author: { user_openid: 'user-1' }
    })

    expect(message).toMatchObject({
      id: 'msg-2',
      scene: 'c2c',
      userId: 'user-1',
      content: 'hi'
    })
  })

  it('忽略未知事件', () => {
    expect(normalizeQQEvent('GUILD_CREATE', { id: 'x' })).toBeNull()
  })
})

describe('MessageDeduper', () => {
  it('识别重复消息 id', () => {
    const deduper = new MessageDeduper(2)
    expect(deduper.seen('a')).toBe(false)
    expect(deduper.seen('a')).toBe(true)
    expect(deduper.seen('b')).toBe(false)
    expect(deduper.seen('c')).toBe(false)
    expect(deduper.seen('a')).toBe(false)
  })
})
