import type { QQMessage, QQSendInput, QQSendResult } from '@arqqbot/shared'

const MAX_PREVIEW = 200

export function previewContent(content: string, max = MAX_PREVIEW): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (normalized.length === 0) return ''
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}…`
}

export function sceneLabel(scene: 'c2c' | 'group'): string {
  return scene === 'group' ? '群聊' : '单聊'
}

export function formatIncoming(message: QQMessage): string {
  const target =
    message.scene === 'group'
      ? `群 ${message.groupId ?? ''} / 成员 ${message.userId}`
      : `用户 ${message.userId}`
  const content = previewContent(message.content) || '[非文本消息]'
  return `收到${sceneLabel(message.scene)}消息（${target}，消息 ${message.id}）：${content}`
}

export function formatOutgoing(input: QQSendInput, result?: QQSendResult): string {
  const target = input.scene === 'group' ? `群 ${input.targetId}` : `用户 ${input.targetId}`
  const receipt = result?.messageId ? `，回执 ${result.messageId}` : ''
  return `已发送${sceneLabel(input.scene)}消息（${target}${receipt}）：${previewContent(input.content)}`
}

export function isMessageLog(message: string): boolean {
  return message.startsWith('收到') || message.startsWith('已发送')
}
