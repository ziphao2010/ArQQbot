import { describe, expect, it } from 'vitest'
import type { QQMessage } from '@arqqbot/shared'
import {
  formatIncoming,
  formatOutgoing,
  isMessageLog,
  previewContent,
  sceneLabel
} from '../src/log-format'

const groupMessage: QQMessage = {
  id: 'msg-1',
  scene: 'group',
  userId: 'member-1',
  groupId: 'group-1',
  content: '  你好\n世界  ',
  mentions: [],
  attachments: [],
  timestamp: '2026-10-31T10:00:00+08:00',
  raw: {}
}

describe('log-format', () => {
  it('格式化收到的群聊消息并压缩空白', () => {
    expect(formatIncoming(groupMessage)).toBe(
      '收到群聊消息（群 group-1 / 成员 member-1，消息 msg-1）：你好 世界'
    )
  })

  it('非文本消息使用占位描述', () => {
    expect(formatIncoming({ ...groupMessage, content: '' })).toContain('[非文本消息]')
  })

  it('格式化发送消息并截断过长内容', () => {
    const long = 'a'.repeat(250)
    const text = formatOutgoing(
      { scene: 'c2c', targetId: 'user-1', content: long, msgId: 'msg-1' },
      { messageId: 'reply-1' }
    )
    expect(text).toContain('已发送单聊消息（用户 user-1，回执 reply-1）')
    expect(text).toContain('a'.repeat(200) + '…')
  })

  it('识别消息日志与场景标签', () => {
    expect(sceneLabel('group')).toBe('群聊')
    expect(sceneLabel('c2c')).toBe('单聊')
    expect(isMessageLog('收到群聊消息')).toBe(true)
    expect(isMessageLog('已发送单聊消息')).toBe(true)
    expect(isMessageLog('实例开始启动')).toBe(false)
    expect(previewContent('  ')).toBe('')
  })
})
