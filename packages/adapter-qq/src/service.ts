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
import { MessageDeduper, normalizeQQEvent } from './message'
import { QQSender } from './sender'
import { TokenManager } from './token'

const API_BASE: Record<InstanceEnv, string> = {
  production: 'https://api.sgroup.qq.com',
  sandbox: 'https://sandbox.api.sgroup.qq.com'
}

export interface QQAdapterConfig {
  appId: string
  appSecret: string
  env: InstanceEnv
  intents?: number
}

export class QQAdapter extends Service implements QQService {
  private readonly token: TokenManager
  private readonly sender: QQSender
  private readonly deduper = new MessageDeduper()
  private readonly stats = { received: 0, sent: 0 }
  private readonly baseUrl: string
  private gateway?: GatewayClient

  constructor(ctx: Context, private readonly config: QQAdapterConfig) {
    super(ctx, 'qq')
    this.baseUrl = API_BASE[config.env]
    this.token = new TokenManager({
      appId: config.appId,
      appSecret: config.appSecret
    })
    this.sender = new QQSender({ token: this.token, baseUrl: this.baseUrl })
  }

  async connect(): Promise<void> {
    const accessToken = await this.token.get()
    const response = await fetch(`${this.baseUrl}/gateway/bot`, {
      headers: { authorization: `QQBot ${accessToken}` }
    })

    if (!response.ok) {
      throw new Error(`获取网关地址失败：HTTP ${response.status}`)
    }

    const body = (await response.json()) as { url?: unknown }
    if (typeof body.url !== 'string') {
      throw new Error('获取网关地址失败：响应缺少 url')
    }

    this.gateway = new GatewayClient({
      url: body.url,
      getToken: () => this.token.get(),
      intents: this.config.intents ?? 1 << 25,
      handlers: {
        onDispatch: (event, data) => this.handleDispatch(event, data),
        onReady: () => {
          this.ctx.emit('qq/ready')
          this.ctx.logger.info('QQ 网关已就绪')
        },
        onError: (error) => {
          this.ctx.emit('qq/error', error)
          this.ctx.logger.error('QQ 网关错误', error, 'adapter-qq')
        }
      }
    })

    await this.gateway.connect()
  }

  async disconnect(): Promise<void> {
    this.gateway?.close()
    this.gateway = undefined
  }

  async send(input: QQSendInput): Promise<QQSendResult> {
    const result = await this.sender.send(input)
    this.stats.sent += 1
    return result
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
    if (!message) return
    if (this.deduper.seen(message.id)) return
    this.stats.received += 1
    void this.ctx.parallel('qq/message', message).catch((error) => {
      this.ctx.logger.error('插件处理消息失败', error, 'adapter-qq')
    })
  }
}
