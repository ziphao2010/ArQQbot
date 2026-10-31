import type { QQSendInput, QQSendResult } from '@arqqbot/shared'
import { QQCapabilityRegistry } from './core/capability-registry'
import { QQApiError } from './core/errors'
import { QQHttpClient } from './core/http-client'
import { QQMessageModule } from './modules/messages'
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
  token?: TokenManager
  baseUrl?: string
  fetchImpl?: typeof fetch
  now?: () => number
  maxTextLength?: number
  messages?: QQMessageModule
}

export class QQSender {
  private readonly messages: QQMessageModule

  constructor(options: QQSenderOptions) {
    if (options.messages) {
      this.messages = options.messages
      return
    }

    if (!options.token || !options.baseUrl) {
      throw new Error('QQSender 需要 token/baseUrl 或 messages')
    }

    const http = new QQHttpClient({
      token: options.token,
      baseUrls: [options.baseUrl],
      fetchImpl: options.fetchImpl,
      now: options.now
    })
    const capabilities = new QQCapabilityRegistry({ env: 'production', intents: 0 })
    this.messages = new QQMessageModule({
      http,
      capabilities,
      quota: new PassiveReplyQuota(options.now ?? Date.now),
      maxTextLength: options.maxTextLength
    })
  }

  async send(input: QQSendInput): Promise<QQSendResult> {
    if (!input.msgId) {
      throw new QQSendError('ACTIVE_MESSAGE_UNSUPPORTED', 'MVP 不支持主动消息')
    }

    try {
      return await this.messages.send({
        target:
          input.scene === 'group'
            ? { scene: 'group', groupId: input.targetId }
            : { scene: 'c2c', userId: input.targetId },
        content: { type: 'text', text: input.content },
        replyTo: input.msgId
      })
    } catch (error) {
      if (error instanceof QQApiError) {
        if (error.code === 'QUOTA_EXCEEDED') {
          throw new QQSendError('QUOTA_EXCEEDED', error.message, error.meta.status)
        }
        throw new QQSendError('QQ_API_ERROR', error.message, error.meta.status)
      }
      throw error
    }
  }
}
