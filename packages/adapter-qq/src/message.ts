import type { QQMessage } from '@arqqbot/shared'

interface AttachmentPayload {
  content_type?: string
  url?: string
  filename?: string
  size?: number
}

function normalizeAttachments(input: unknown): QQMessage['attachments'] {
  if (!Array.isArray(input)) return []
  return input.map((item) => {
    const attachment = item as AttachmentPayload
    const result: QQMessage['attachments'][number] = {
      contentType: attachment.content_type ?? '',
      url: attachment.url ?? ''
    }
    if (attachment.filename !== undefined) result.filename = attachment.filename
    if (attachment.size !== undefined) result.size = attachment.size
    return result
  })
}

export function normalizeQQEvent(eventName: string, data: Record<string, any>): QQMessage | null {
  if (eventName === 'GROUP_AT_MESSAGE_CREATE') {
    return {
      id: String(data.id ?? ''),
      scene: 'group',
      userId: String(data.author?.member_openid ?? ''),
      groupId: String(data.group_openid ?? ''),
      content: String(data.content ?? '').trim(),
      mentions: [],
      attachments: normalizeAttachments(data.attachments),
      timestamp: String(data.timestamp ?? ''),
      raw: data
    }
  }

  if (eventName === 'C2C_MESSAGE_CREATE') {
    return {
      id: String(data.id ?? ''),
      scene: 'c2c',
      userId: String(data.author?.user_openid ?? ''),
      content: String(data.content ?? '').trim(),
      mentions: [],
      attachments: normalizeAttachments(data.attachments),
      timestamp: String(data.timestamp ?? ''),
      raw: data
    }
  }

  return null
}

export class MessageDeduper {
  private readonly ids = new Set<string>()
  private readonly limit: number

  constructor(limit = 10_000) {
    this.limit = limit
  }

  seen(id: string): boolean {
    if (this.ids.has(id)) return true
    this.ids.add(id)
    if (this.ids.size > this.limit) {
      const first = this.ids.values().next().value
      if (typeof first === 'string') this.ids.delete(first)
    }
    return false
  }
}
