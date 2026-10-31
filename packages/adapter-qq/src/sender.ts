import type { QQSendInput, QQSendResult } from '@arqqbot/shared'
import { PassiveReplyQuota } from './quota'
import type { TokenManager } from './token'

export type QQSendErrorCode =
  | 'ACTIVE_MESSAGE_UNSUPPORTED'
  | 'QUOTA_EXCEEDED'
  | 'QQ_API_ERROR'

export class QQSendError extends Error {
  readonly code: QQSendErrorCode
  readonly status?: number

  constructor(code: QQSendErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'QQSendError'
    this.code = code
    this.status = status
  }
}

export interface QQSenderOptions {
  token: TokenManager
  baseUrl: string
  fetchImpl?: typeof fetch
  now?: () => number
  maxTextLength?: number
}

function splitText(content: string, maxLength: number): string[] {
  if (content.length <= maxLength) return [content]
  const chunks: string[] = []
  for (let index = 0; index < content.length; index += maxLength) {
    chunks.push(content.slice(index, index + maxLength))
  }
  return chunks
}

export class QQSender {
  private readonly fetchImpl: typeof fetch
  private readonly quota: PassiveReplyQuota
  private readonly maxTextLength: number

  constructor(private readonly options: QQSenderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.quota = new PassiveReplyQuota(options.now ?? Date.now)
    this.maxTextLength = options.maxTextLength ?? 5000
  }

  private endpoint(input: QQSendInput): string {
    const target = encodeURIComponent(input.targetId)
    return input.scene === 'group'
      ? `${this.options.baseUrl}/v2/groups/${target}/messages`
      : `${this.options.baseUrl}/v2/users/${target}/messages`
  }

  async send(input: QQSendInput): Promise<QQSendResult> {
    if (!input.msgId) {
      throw new QQSendError('ACTIVE_MESSAGE_UNSUPPORTED', 'MVP 不支持主动消息')
    }

    const accessToken = await this.options.token.get()
    const chunks = splitText(input.content, this.maxTextLength)
    let messageId: string | undefined

    for (const chunk of chunks) {
      if (!this.quota.consume(input.scene, input.msgId)) {
        throw new QQSendError('QUOTA_EXCEEDED', '被动回复次数已用完')
      }

      const response = await this.fetchImpl(this.endpoint(input), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `QQBot ${accessToken}`
        },
        body: JSON.stringify({
          content: chunk,
          msg_type: 0,
          msg_id: input.msgId,
          msg_seq: this.quota.nextSeq(input.msgId)
        })
      })

      const body = (await response.json().catch(() => ({}))) as { id?: unknown; message?: unknown }
      if (!response.ok) {
        const reason = typeof body.message === 'string' ? body.message : `HTTP ${response.status}`
        throw new QQSendError('QQ_API_ERROR', reason, response.status)
      }
      if (typeof body.id === 'string') messageId = body.id
    }

    return { messageId }
  }
}
