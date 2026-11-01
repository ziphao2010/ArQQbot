import { Service, type Context } from 'cordis'
import type {
  InstanceEnv,
  QQDomainEventName,
  QQIntentName,
  QQMessage,
  QQRawRequest,
  QQSendInput,
  QQSendResult,
  QQService,
  QQStats
} from '@arqqbot/shared'
import { QQCapabilityRegistry } from './core/capability-registry'
import { findEndpoint } from './core/endpoint-catalog'
import { QQApiError as QQApiFailure } from './core/errors'
import { QQHttpClient } from './core/http-client'
import { DEFAULT_INTENTS, resolveIntents } from './core/intent-map'
import { QQEventRouter } from './events/router'
import { GatewayClient, type SocketFactory } from './gateway'
import { formatIncoming, previewContent } from './log-format'
import { MessageDeduper } from './message'
import { QQBotModule } from './modules/bot'
import { QQGuildModule } from './modules/guilds'
import { QQGroupModule } from './modules/groups'
import { QQInteractionModule } from './modules/interactions'
import { QQMediaModule } from './modules/media'
import { QQMenuModule } from './modules/menus'
import { QQMessageModule } from './modules/messages'
import { QQPanelModule } from './modules/panels'
import { QQSender } from './sender'
import { TokenManager } from './token'

const API_BASES: Record<InstanceEnv, string[]> = {
  production: ['https://api.bot.qq.com', 'https://api.sgroup.qq.com'],
  sandbox: ['https://api.bot.qq.com', 'https://sandbox.api.sgroup.qq.com']
}

export interface QQAdapterConfig {
  appId: string
  appSecret: string
  env: InstanceEnv
  intents?: number | QQIntentName[]
  fetchImpl?: typeof fetch
  socketFactory?: SocketFactory
  baseUrls?: string[]
}

function resolveAdapterIntents(input: number | QQIntentName[] | undefined): number {
  if (typeof input === 'number') return input
  return resolveIntents(input ?? DEFAULT_INTENTS)
}

export class QQAdapter extends Service implements QQService {
  readonly message: QQMessageModule
  readonly media: QQMediaModule
  readonly group: QQGroupModule
  readonly guild: QQGuildModule
  readonly interaction: QQInteractionModule
  readonly menu: QQMenuModule
  readonly panels: QQPanelModule
  readonly bot: QQBotModule
  readonly capabilities: QQCapabilityRegistry

  private readonly token: TokenManager
  private readonly http: QQHttpClient
  private readonly sender: QQSender
  private readonly router: QQEventRouter
  private readonly intentsMask: number
  private readonly deduper = new MessageDeduper()
  private readonly stats = { received: 0, sent: 0 }
  private readonly log: ReturnType<Context['logger']>
  private gateway?: GatewayClient

  constructor(ctx: Context, private readonly config: QQAdapterConfig) {
    super(ctx, 'qq')
    this.log = ctx.logger('qq-adapter')
    this.intentsMask = resolveAdapterIntents(config.intents)

    this.token = new TokenManager({
      appId: config.appId,
      appSecret: config.appSecret,
      fetchImpl: config.fetchImpl
    })

    this.capabilities = new QQCapabilityRegistry({
      env: config.env,
      intents: this.intentsMask
    })

    this.http = new QQHttpClient({
      token: this.token,
      baseUrls: config.baseUrls ?? API_BASES[config.env],
      fetchImpl: config.fetchImpl,
      logger: {
        info: (message) => this.log.info(message),
        warn: (message, error) => this.log.warn(message, error)
      }
    })

    this.message = new QQMessageModule({
      http: this.http,
      capabilities: this.capabilities,
      onSent: (input, result) => this.logSent(input, result)
    })

    this.media = new QQMediaModule({
      http: this.http,
      capabilities: this.capabilities,
      fetchImpl: config.fetchImpl
    })

    this.group = new QQGroupModule({ http: this.http, capabilities: this.capabilities })
    this.guild = new QQGuildModule({ http: this.http, capabilities: this.capabilities })
    this.interaction = new QQInteractionModule({
      http: this.http,
      capabilities: this.capabilities
    })
    this.menu = new QQMenuModule({ http: this.http, capabilities: this.capabilities })
    this.panels = new QQPanelModule({ http: this.http, capabilities: this.capabilities })
    this.bot = new QQBotModule({ http: this.http, capabilities: this.capabilities })

    this.sender = new QQSender({ messages: this.message })

    this.router = new QQEventRouter({
      emit: (event, payload) => this.emit(event, payload),
      deduper: this.deduper,
      onMessage: (message, event) => this.logIncoming(message, event),
      onUnknown: (type) => this.log.info(`收到暂未处理的 QQ 事件：${type}`)
    })
  }

  async connect(): Promise<void> {
    const url = await this.resolveGatewayUrl()
    const gateway = new GatewayClient({
      url,
      getToken: () => this.token.get(),
      intents: this.intentsMask,
      socketFactory: this.config.socketFactory,
      handlers: {
        onDispatch: (event, data) => {
          this.router.handle(event, data)
        },
        onReady: () => {
          this.ctx.emit('qq/ready')
          this.log.info('QQ 网关已就绪')
        },
        onError: (error) => {
          this.ctx.emit('qq/error', error)
          this.log.error('QQ 网关错误', error)
        },
        onClose: () => {
          this.ctx.emit('qq/disconnect')
          this.log.warn('QQ 网关连接已断开')
        }
      }
    })

    await gateway.connect()
    this.gateway = gateway
  }

  async disconnect(): Promise<void> {
    this.gateway?.close()
    this.gateway = undefined
    this.ctx.emit('qq/disconnect')
  }

  async send(input: QQSendInput): Promise<QQSendResult> {
    if (!this.gateway) throw new Error('QQ 适配器尚未连接')
    try {
      return await this.sender.send(input)
    } catch (error) {
      this.log.warn(`发送${input.scene === 'group' ? '群聊' : '单聊'}消息失败`, error)
      throw error
    }
  }

  request<T>(input: QQRawRequest): Promise<T> {
    return this.http.raw<T>(input)
  }

  getStats(): QQStats {
    return {
      connected: this.gateway?.connected ?? false,
      received: this.stats.received,
      sent: this.stats.sent
    }
  }

  private async resolveGatewayUrl(): Promise<string> {
    try {
      const result = await this.http.request<{ url?: unknown }>(findEndpoint('bot.gateway'))
      if (typeof result?.url === 'string') return result.url
      throw new QQApiFailure('SERVER_ERROR', '网关响应缺少 url', { endpointId: 'bot.gateway' })
    } catch (error) {
      const fallback = await this.http.raw<{ url?: unknown }>({
        method: 'GET',
        path: '/gateway/bot'
      })
      if (typeof fallback?.url === 'string') return fallback.url
      throw error
    }
  }

  private emit(event: QQDomainEventName, payload: unknown): void {
    ;(this.ctx.emit as unknown as (name: string, value: unknown) => void)(event, payload)
  }

  private logSent(input: Parameters<QQMessageModule['send']>[0], result: QQSendResult): void {
    const target =
      input.target.scene === 'group'
        ? `群 ${input.target.groupId}`
        : `用户 ${input.target.userId}`
    const preview =
      input.content.type === 'text' ? previewContent(input.content.text) : `[${input.content.type} 消息]`
    const receipt = result.messageId ? `，回执 ${result.messageId}` : ''
    this.log.info(
      `已发送${input.target.scene === 'group' ? '群聊' : '单聊'}消息（${target}${receipt}）：${preview}`
    )
    this.stats.sent += 1
  }

  private logIncoming(message: QQMessage, event: QQDomainEventName): void {
    if (event === 'qq/message') {
      this.stats.received += 1
      this.log.info(formatIncoming(message))
      return
    }
    this.log.info(`收到 ${event} 消息（消息 ${message.id}）`)
  }
}
