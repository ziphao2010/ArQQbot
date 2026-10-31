import { describe, expect, it } from 'vitest'
import { normalizeEvent } from '../src/events/normalize'

const FIXTURES: Array<[string, Record<string, any>, string]> = [
  ['INTERACTION_CREATE', { id: 'interaction-1' }, 'qq/interaction'],
  ['SUBSCRIBE_MESSAGE_STATUS', { openid: 'user-1' }, 'qq/subscribe-status'],
  ['FRIEND_ADD', { openid: 'user-1' }, 'qq/friend-add'],
  ['FRIEND_DEL', { openid: 'user-1' }, 'qq/friend-del'],
  [
    'C2C_MESSAGE_CREATE',
    { id: 'm-1', content: 'hi', author: { user_openid: 'user-1' } },
    'qq/message'
  ],
  ['C2C_MSG_RECEIVE', { openid: 'user-1', message_id: 'm-1' }, 'qq/c2c-msg-receive'],
  ['C2C_MSG_REJECT', { openid: 'user-1', message_id: 'm-1' }, 'qq/c2c-msg-reject'],
  ['GROUP_ADD_ROBOT', { group_openid: 'g-1', op_member_openid: 'member-1' }, 'qq/group-add'],
  ['GROUP_DEL_ROBOT', { group_openid: 'g-1' }, 'qq/group-del'],
  [
    'GROUP_JOIN_REQUEST',
    { group_openid: 'g-1', member_openid: 'member-1' },
    'qq/group-join-request'
  ],
  ['GROUP_MSG_RECEIVE', { group_openid: 'g-1', message_id: 'm-1' }, 'qq/group-msg-receive'],
  ['GROUP_MSG_REJECT', { group_openid: 'g-1', message_id: 'm-1' }, 'qq/group-msg-reject'],
  [
    'GROUP_AT_MESSAGE_CREATE',
    { id: 'm-2', group_openid: 'g-1', content: '@bot hi', author: { member_openid: 'member-1' } },
    'qq/message'
  ],
  [
    'GROUP_MESSAGE_CREATE',
    { id: 'm-3', group_openid: 'g-1', content: 'hi', author: { member_openid: 'member-1' } },
    'qq/group-message'
  ],
  [
    'GROUP_MEMBER_ADD',
    { group_openid: 'g-1', member_openid: 'member-1' },
    'qq/group-member-add'
  ],
  [
    'GROUP_MEMBER_REMOVE',
    { group_openid: 'g-1', member_openid: 'member-1' },
    'qq/group-member-remove'
  ],
  ['GUILD_CREATE', { id: 'guild-1' }, 'qq/guild-create'],
  ['GUILD_UPDATE', { id: 'guild-1' }, 'qq/guild-update'],
  ['GUILD_DELETE', { id: 'guild-1' }, 'qq/guild-delete'],
  ['CHANNEL_CREATE', { id: 'channel-1', guild_id: 'guild-1' }, 'qq/channel-create'],
  ['CHANNEL_UPDATE', { id: 'channel-1', guild_id: 'guild-1' }, 'qq/channel-update'],
  ['CHANNEL_DELETE', { id: 'channel-1', guild_id: 'guild-1' }, 'qq/channel-delete']
]

describe('normalizeEvent', () => {
  for (const [type, data, expected] of FIXTURES) {
    it(`归一化 ${type}`, () => {
      const event = normalizeEvent(type, data)
      expect(event, `事件未归一化：${type}`).toBeTruthy()
      expect(event?.event).toBe(expected)
    })
  }

  it('归一化群 @ 消息并保留兼容字段', () => {
    const event = normalizeEvent('GROUP_AT_MESSAGE_CREATE', {
      id: 'msg-1',
      group_openid: 'group-1',
      content: ' 你好',
      timestamp: '2026-11-01T10:00:00+08:00',
      author: { member_openid: 'member-1' },
      attachments: [
        { content_type: 'image/png', url: 'https://img.test/a.png', filename: 'a.png', size: 100 }
      ]
    })

    expect(event?.event).toBe('qq/message')
    expect(event?.message).toMatchObject({
      id: 'msg-1',
      scene: 'group',
      groupId: 'group-1',
      userId: 'member-1',
      content: '你好'
    })
    expect(event?.message?.attachments[0]?.contentType).toBe('image/png')
  })

  it('频道与私信消息使用独立事件', () => {
    const guild = normalizeEvent('AT_MESSAGE_CREATE', {
      id: 'gm-1',
      guild_id: 'guild-1',
      channel_id: 'channel-1',
      content: 'hi',
      author: { id: 'user-1', username: 'Alice' }
    })
    expect(guild?.event).toBe('qq/guild-message')
    expect(guild?.message).toMatchObject({
      scene: 'guild',
      guildId: 'guild-1',
      channelId: 'channel-1',
      userId: 'user-1'
    })

    const dm = normalizeEvent('DIRECT_MESSAGE_CREATE', {
      id: 'dm-1',
      guild_id: 'guild-1',
      channel_id: 'channel-1',
      content: 'hi',
      author: { id: 'user-1' }
    })
    expect(dm?.event).toBe('qq/dm-message')
    expect(dm?.message).toMatchObject({ scene: 'dm', userId: 'user-1' })
  })

  it('领域事件附带规范化别名', () => {
    const group = normalizeEvent('GROUP_ADD_ROBOT', { group_openid: 'g-1' })
    expect(group?.payload).toMatchObject({ groupOpenid: 'g-1' })

    const channel = normalizeEvent('CHANNEL_CREATE', { id: 'c-1', guild_id: 'guild-1' })
    expect(channel?.payload).toMatchObject({ channelId: 'c-1', guildId: 'guild-1' })
  })

  it('未知事件返回 null', () => {
    expect(normalizeEvent('UNKNOWN_EVENT', {})).toBeNull()
  })
})
