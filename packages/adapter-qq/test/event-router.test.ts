import { describe, expect, it, vi } from 'vitest'
import type { QQDomainEventName, QQMessage } from '@arqqbot/shared'
import { QQEventRouter } from '../src/events/router'
import { MessageDeduper } from '../src/message'

describe('QQEventRouter', () => {
  it('先发 raw-event，再发 qq/message', () => {
    const emitted: Array<{ event: string; payload: unknown }> = []
    const onMessage = vi.fn()
    const router = new QQEventRouter({
      emit: (event, payload) => emitted.push({ event, payload }),
      deduper: new MessageDeduper(),
      onMessage
    })

    router.handle('GROUP_AT_MESSAGE_CREATE', {
      id: 'msg-1',
      group_openid: 'group-1',
      content: 'hi',
      author: { member_openid: 'member-1' }
    })

    expect(emitted[0]?.event).toBe('qq/raw-event')
    expect(emitted[1]?.event).toBe('qq/message')
    expect(onMessage).toHaveBeenCalledTimes(1)
  })

  it('重复消息只分发一次 qq/message', () => {
    const emitted: Array<{ event: string; payload: unknown }> = []
    const router = new QQEventRouter({
      emit: (event, payload) => emitted.push({ event, payload }),
      deduper: new MessageDeduper()
    })
    const data = {
      id: 'msg-1',
      group_openid: 'group-1',
      content: 'hi',
      author: { member_openid: 'member-1' }
    }

    router.handle('GROUP_AT_MESSAGE_CREATE', data)
    router.handle('GROUP_AT_MESSAGE_CREATE', data)

    expect(emitted.filter((item) => item.event === 'qq/raw-event')).toHaveLength(2)
    expect(emitted.filter((item) => item.event === 'qq/message')).toHaveLength(1)
  })

  it('领域事件携带规范化 payload', () => {
    const emitted: Array<{ event: string; payload: unknown }> = []
    const router = new QQEventRouter({
      emit: (event, payload) => emitted.push({ event, payload })
    })

    router.handle('GROUP_MEMBER_ADD', {
      group_openid: 'g-1',
      member_openid: 'member-1'
    })

    expect(emitted[1]).toMatchObject({
      event: 'qq/group-member-add',
      payload: { groupOpenid: 'g-1', memberOpenid: 'member-1' }
    })
  })

  it('群全量消息使用 qq/group-message', () => {
    const emitted: Array<{ event: string; payload: unknown }> = []
    const router = new QQEventRouter({
      emit: (event, payload) => emitted.push({ event, payload })
    })

    router.handle('GROUP_MESSAGE_CREATE', {
      id: 'msg-1',
      group_openid: 'g-1',
      content: 'hi',
      author: { member_openid: 'member-1' }
    })

    expect(emitted[1]?.event).toBe('qq/group-message')
  })

  it('未知事件只发 raw-event 并回调 onUnknown', () => {
    const emitted: Array<{ event: string; payload: unknown }> = []
    const onUnknown = vi.fn()
    const router = new QQEventRouter({
      emit: (event, payload) => emitted.push({ event, payload }),
      onUnknown
    })

    const result = router.handle('UNKNOWN_EVENT', { id: 'x' })

    expect(result).toBeNull()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.event).toBe('qq/raw-event')
    expect(onUnknown).toHaveBeenCalledWith('UNKNOWN_EVENT', { id: 'x' })
  })
})
