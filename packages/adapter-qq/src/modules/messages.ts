import type {
  QQMessage,
  QQMessageContent,
  QQSendMessageInput,
  QQSendResult,
  QQSendTarget,
  QQStreamHandle,
  QQStreamInput
} from '@arqqbot/shared'
import type { QQCapabilityGuard } from '../core/capability-registry'
import type { QQEndpointSpec } from '../core/endpoint-catalog'
import { findEndpoint } from '../core/endpoint-catalog'
import { QQApiError } from '../core/errors'
import type { QQHttpClient } from '../core/http-client'
import { PassiveReplyQuota } from '../quota'

export interface QQMessageModuleOptions {
  http: QQHttpClient
  capabilities?: QQCapabilityGuard
  quota?: PassiveReplyQuota
  now?: () => number
  maxTextLength?: number
  onSent?: (input: QQSendMessageInput, result: QQSendResult) => void
}

function splitText(content: string, maxLength: number): string[] {
  if (content.length <= maxLength) return [content]
  const chunks: string[] = []
  for (let index = 0; index < content.length; index += maxLength) {
    chunks.push(content.slice(index, index + maxLength))
  }
  return chunks
}

function pathParamsFor(target: QQSendTarget): Record<string, string> {
  return target.scene === 'group'
    ? { group_openid: target.groupId }
    : { user_openid: target.userId }
}

class HttpStreamHandle implements QQStreamHandle {
  private streamMessageId?: string
  private index = 0
  private content = ''
  private ended = false

  constructor(
    private readonly http: QQHttpClient,
    private readonly endpoint: QQEndpointSpec,
    private readonly pathParams: Record<string, string>,
    private readonly credentials: Record<string, unknown>
  ) {}

  async write(chunk: string): Promise<void> {
    if (this.ended) throw new QQApiError('BAD_REQUEST', '流式消息已结束')
    this.content += chunk
    await this.push(1)
  }

  async end(): Promise<void> {
    if (this.ended) return
    await this.push(10)
    this.ended = true
  }

  private async push(inputState: number): Promise<void> {
    const body: Record<string, unknown> = {
      input_mode: 'replace',
      input_state: inputState,
      index: this.index,
      content_type: 'markdown',
      content_raw: this.content,
      ...this.credentials
    }
    if (this.streamMessageId) body.stream_msg_id = this.streamMessageId

    const result = await this.http.request<{ id?: unknown }>(this.endpoint, {
      pathParams: this.pathParams,
      body
    })

    if (!this.streamMessageId && typeof result?.id === 'string') {
      this.streamMessageId = result.id
    }
    this.index += 1
  }
}

export class QQMessageModule {
  private readonly http: QQHttpClient
  private readonly capabilities?: QQCapabilityGuard
  private readonly quota: PassiveReplyQuota
  private readonly maxTextLength: number
  private readonly onSent?: (input: QQSendMessageInput, result: QQSendResult) => void

  constructor(options: QQMessageModuleOptions) {
    this.http = options.http
    this.capabilities = options.capabilities
    this.quota = options.quota ?? new PassiveReplyQuota(options.now ?? Date.now)
    this.maxTextLength = options.maxTextLength ?? 5000
    this.onSent = options.onSent
  }

  async send(input: QQSendMessageInput): Promise<QQSendResult> {
    this.capabilities?.assert('message.send')
    if (!input.replyTo && !input.eventId) {
      throw new QQApiError('CAPABILITY_UNAVAILABLE', '主动消息默认未开放：请提供 replyTo 或 eventId')
    }

    const result =
      input.content.type === 'text'
        ? await this.sendText(input, input.content.text)
        : await this.sendRich(input, input.content)

    this.onSent?.(input, result)
    return result
  }

  async reply(source: QQMessage, content: QQMessageContent): Promise<QQSendResult> {
    let target: QQSendTarget
    if (source.scene === 'group') {
      if (!source.groupId) throw new QQApiError('BAD_REQUEST', '群消息缺少 groupId')
      target = { scene: 'group', groupId: source.groupId }
    } else if (source.scene === 'c2c') {
      target = { scene: 'c2c', userId: source.userId }
    } else {
      throw new QQApiError('CAPABILITY_UNAVAILABLE', `场景 ${source.scene} 暂不支持发送`)
    }

    return this.send({ target, content, replyTo: source.id })
  }

  async recall(scene: 'c2c' | 'group', targetId: string, messageId: string): Promise<void> {
    this.capabilities?.assert('message.recall')
    const endpoint = findEndpoint(
      scene === 'group' ? 'group.message.recall' : 'c2c.message.recall'
    )
    const pathParams: Record<string, string> =
      scene === 'group'
        ? { group_openid: targetId, message_id: messageId }
        : { user_openid: targetId, message_id: messageId }

    await this.http.request<unknown>(endpoint, { pathParams })
  }

  async sendStream(input: QQStreamInput): Promise<QQStreamHandle> {
    this.capabilities?.assert('message.stream')
    if (input.target.scene !== 'c2c') {
      throw new QQApiError('CAPABILITY_UNAVAILABLE', '流式发送目前仅支持单聊')
    }
    if (!input.replyTo && !input.eventId) {
      throw new QQApiError('CAPABILITY_UNAVAILABLE', '主动消息默认未开放：请提供 replyTo 或 eventId')
    }

    let msgSeq = input.msgSeq ?? 1
    if (input.replyTo) {
      if (!this.quota.consume('c2c', input.replyTo)) {
        throw new QQApiError('QUOTA_EXCEEDED', '被动回复次数已用完')
      }
      msgSeq = input.msgSeq ?? this.quota.nextSeq(input.replyTo)
    }

    const credentials: Record<string, unknown> = { msg_seq: msgSeq }
    if (input.replyTo) credentials.msg_id = input.replyTo
    if (input.eventId) credentials.event_id = input.eventId

    return new HttpStreamHandle(
      this.http,
      findEndpoint('c2c.message.stream'),
      { user_openid: input.target.userId },
      credentials
    )
  }

  private async sendText(
    input: QQSendMessageInput,
    text: string
  ): Promise<QQSendResult> {
    const endpoint = this.sendEndpoint(input.target)
    const pathParams = pathParamsFor(input.target)
    const chunks = splitText(text, this.maxTextLength)
    let messageId: string | undefined

    for (const [index, chunk] of chunks.entries()) {
      if (input.replyTo && !this.quota.consume(input.target.scene, input.replyTo)) {
        throw new QQApiError('QUOTA_EXCEEDED', '被动回复次数已用完')
      }

      const msgSeq =
        input.msgSeq !== undefined
          ? input.msgSeq + index
          : input.replyTo
            ? this.quota.nextSeq(input.replyTo)
            : 1

      const body: Record<string, unknown> = {
        content: chunk,
        msg_type: 0,
        msg_seq: msgSeq
      }
      if (input.replyTo) body.msg_id = input.replyTo
      if (input.eventId) body.event_id = input.eventId

      const result = await this.http.request<{ id?: unknown }>(endpoint, {
        pathParams,
        body
      })
      if (typeof result?.id === 'string') messageId = result.id
    }

    return { messageId }
  }

  private async sendRich(
    input: QQSendMessageInput,
    content: Exclude<QQMessageContent, { type: 'text' }>
  ): Promise<QQSendResult> {
    if (input.replyTo && !this.quota.consume(input.target.scene, input.replyTo)) {
      throw new QQApiError('QUOTA_EXCEEDED', '被动回复次数已用完')
    }

    const msgSeq =
      input.msgSeq ??
      (input.replyTo ? this.quota.nextSeq(input.replyTo) : 1)
    const body: Record<string, unknown> = { msg_seq: msgSeq }
    if (input.replyTo) body.msg_id = input.replyTo
    if (input.eventId) body.event_id = input.eventId

    switch (content.type) {
      case 'markdown':
        body.msg_type = 2
        body.markdown = content.markdown
        if (content.keyboard) body.keyboard = content.keyboard
        break
      case 'ark':
        body.msg_type = 3
        body.ark = content.ark
        break
      case 'embed':
        body.msg_type = 4
        body.embed = content.embed
        break
      case 'media':
        body.msg_type = 7
        body.media = { file_info: content.fileInfo }
        break
    }

    const result = await this.http.request<{ id?: unknown }>(this.sendEndpoint(input.target), {
      pathParams: pathParamsFor(input.target),
      body
    })

    return typeof result?.id === 'string' ? { messageId: result.id } : {}
  }

  private sendEndpoint(target: QQSendTarget): QQEndpointSpec {
    return findEndpoint(target.scene === 'group' ? 'group.message.send' : 'c2c.message.send')
  }
}
