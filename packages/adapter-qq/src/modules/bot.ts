import type { QQBotInfo, QQGuild, QQUrlLinkInput } from '@arqqbot/shared'
import type { QQCapabilityGuard } from '../core/capability-registry'
import type { QQHttpClient } from '../core/http-client'
import { findEndpoint } from '../core/endpoint-catalog'
import { QQApiError } from '../core/errors'

export interface QQBotModuleOptions {
  http: QQHttpClient
  capabilities?: QQCapabilityGuard
}

function asGuilds(input: unknown): QQGuild[] {
  if (Array.isArray(input)) return input as QQGuild[]
  if (input && typeof input === 'object') {
    const value = (input as Record<string, unknown>).guilds
    if (Array.isArray(value)) return value as QQGuild[]
  }
  return []
}

export class QQBotModule {
  private readonly http: QQHttpClient
  private readonly capabilities?: QQCapabilityGuard

  constructor(options: QQBotModuleOptions) {
    this.http = options.http
    this.capabilities = options.capabilities
  }

  async me(): Promise<QQBotInfo> {
    this.capabilities?.assert('bot.me')
    return this.http.request<QQBotInfo>(findEndpoint('bot.me'))
  }

  async guilds(): Promise<QQGuild[]> {
    this.capabilities?.assert('bot.guilds')
    const result = await this.http.request<unknown>(findEndpoint('bot.guilds'))
    return asGuilds(result)
  }

  async gateway(): Promise<string> {
    this.capabilities?.assert('bot.gateway')
    const result = await this.http.request<{ url?: unknown }>(findEndpoint('bot.gateway'))
    if (typeof result?.url !== 'string') {
      throw new QQApiError('SERVER_ERROR', '网关响应缺少 url', { endpointId: 'bot.gateway' })
    }
    return result.url
  }

  async generateUrlLink(input: QQUrlLinkInput): Promise<string> {
    this.capabilities?.assert('bot.urlLink')
    const result = await this.http.request<{ data?: { url?: unknown } }>(
      findEndpoint('bot.urlLink'),
      { body: input }
    )
    const url = result?.data?.url
    if (typeof url !== 'string') {
      throw new QQApiError('SERVER_ERROR', '生成 URL Link 响应缺少 url', {
        endpointId: 'bot.urlLink'
      })
    }
    return url
  }
}
