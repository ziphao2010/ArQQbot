import { Service, type Context } from 'cordis'
import type {
  InstanceEnv,
  QQMessage,
  QQSendInput,
  QQSendResult,
  QQService,
  QQStats
} from '@arqqbot/shared'
import { GatewayClient } from './gateway'
import { formatIncoming, formatOutgoing } from './log-format'
import { MessageDeduper, normalizeQQEvent } from './message'
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
  intents?: number
}

export class QQAdapter extends Service implements QQService {
  private readonly token: TokenManager
  private sender?: QQSender
  private readonly deduper = new MessageDeduper()
  private readonly stats = { received: 0, sent: 0 }
  private readonly log: ReturnType<Context['logger']>
  private baseUrl: string
  private gateway?: GatewayClient

  constructor(ctx: Context, private readonly config: QQAdapterConfig) {
    super(ctx, 'qq')
    this.baseUrl = API_BASES[config.env][0]!
    this.log = ctx.logger('qq-adapter')
    this.token = new TokenManager({
      appId: config.appId,
      appSecret: config.appSecret
    })
  }

  async connect(): Promise<void> {
    const accessToken = await this.token.get()
    let lastError: unknown

    for (const base of API_BASES[this.config.env]) {
      let gateway: GatewayClient | undefined
      try {
        const response = await fetch(`${base}/gateway/bot`, {
          headers: { authorization: `QQBot ${accessToken}` }
        })

        if (!response.ok) {
          throw new Error(`获取网关地址失败：HTTP ${response.status}`)
        }

        const body = (await response.json()) as { url?: unknown }
        if (typeof body.url !== 'string') {
          throw new Error('获取网关地址失败：响应缺少 url')
        }

        gateway = new GatewayClient({
          url: body.url,
          getToken: () => this.token.get(),
          intents: this.config.intents ?? 1 << 25,
          handlers: {
            onDispatch: (event, data) => this.handleDispatch(event, data),
            onReady: () => {
              this.ctx.emit('qq/ready')
              this.log.info('QQ 网关已就绪')
            },
            onError: (error) => {
              this.ctx.emit('qq/error', error)
              this.log.error('QQ 网关错误', error)
            }
          }
        })

        await gateway.connect()
        this.baseUrl = base
        this.sender = new QQSender({ token: this.token, baseUrl: base })
        this.gateway = gateway
        return
      } catch (error) {
        gateway?.close()
        lastError = error
      }
    }

    throw lastError instanceof Error ? lastError : new Error('获取网关地址失败')
  }

  async disconnect(): Promise<void> {
    this.gateway?.close()
    this.gateway = undefined
  }

  async send(input: QQSendInput): Promise<QQSendResult> {
    if (!this.sender) throw new Error('QQ 适配器尚未连接')
    try {
      const result = await this.sender.send(input)
      this.stats.sent += 1
      this.log.info(formatOutgoing(input, result))
      return result
    } catch (error) {
      this.log.warn(`发送${input.scene === 'group' ? '群聊' : '单聊'}消息失败`, error)
      throw error
    }
  }

  getStats(): QQStats {
    return {
      connected: this.gateway?.connected ?? false,
      received: this.stats.received,
      sent: this.stats.sent
    }
  }

  private handleDispatch(event: string, data: unknown): void {
    const message: QQMessage | null = normalizeQQEvent(event, data as Record<string, any>)
    if (!message) {
      this.log.info(`收到暂未处理的 QQ 事件：${event}`)
      return
    }
    if (this.deduper.seen(message.id)) {
      this.log.warn(`忽略重复消息：${message.id}`)
      return
    }
    this.stats.received += 1
    this.log.info(formatIncoming(message))
    void this.ctx.parallel('qq/message', message).catch((error) => {
      this.log.error('插件处理消息失败', error)
    })
  }
}
