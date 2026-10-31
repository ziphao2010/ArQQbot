import { describe, expect, it } from 'vitest'
import { PassiveReplyQuota } from '../src/quota'

describe('PassiveReplyQuota', () => {
  it('群聊单条消息最多回复 5 次，5 分钟后重置', () => {
    let now = 0
    const quota = new PassiveReplyQuota(() => now)
    for (let index = 0; index < 5; index += 1) {
      expect(quota.consume('group', 'msg-1')).toBe(true)
    }
    expect(quota.consume('group', 'msg-1')).toBe(false)

    now = 5 * 60_000
    expect(quota.consume('group', 'msg-1')).toBe(true)
  })

  it('单聊单条消息最多回复 4 次', () => {
    const quota = new PassiveReplyQuota(() => 0)
    for (let index = 0; index < 4; index += 1) {
      expect(quota.consume('c2c', 'msg-2')).toBe(true)
    }
    expect(quota.consume('c2c', 'msg-2')).toBe(false)
  })

  it('msg_seq 从 1 递增', () => {
    const quota = new PassiveReplyQuota(() => 0)
    expect(quota.nextSeq('msg-1')).toBe(1)
    expect(quota.nextSeq('msg-1')).toBe(2)
    expect(quota.nextSeq('msg-2')).toBe(1)
  })
})
