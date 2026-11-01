import type {
  QQChannel,
  QQChannelInput,
  QQGuild
} from '@arqqbot/shared'
import type { QQCapabilityGuard } from '../core/capability-registry'
import type { QQHttpClient } from '../core/http-client'
import { findEndpoint } from '../core/endpoint-catalog'

export interface QQGuildModuleOptions {
  http: QQHttpClient
  capabilities?: QQCapabilityGuard
}

function asChannels(input: unknown): QQChannel[] {
  if (Array.isArray(input)) return input as QQChannel[]
  if (input && typeof input === 'object') {
    const value = (input as Record<string, unknown>).channels
    if (Array.isArray(value)) return value as QQChannel[]
  }
  return []
}

export class QQGuildModule {
  private readonly http: QQHttpClient
  private readonly capabilities?: QQCapabilityGuard

  constructor(options: QQGuildModuleOptions) {
    this.http = options.http
    this.capabilities = options.capabilities
  }

  async get(guildId: string): Promise<QQGuild> {
    this.capabilities?.assert('guild.get')
    return this.http.request<QQGuild>(findEndpoint('guild.get'), {
      pathParams: { guild_id: guildId }
    })
  }

  async channels(guildId: string): Promise<QQChannel[]> {
    this.capabilities?.assert('guild.channels.list')
    const result = await this.http.request<unknown>(findEndpoint('guild.channels.list'), {
      pathParams: { guild_id: guildId }
    })
    return asChannels(result)
  }

  async channel(channelId: string): Promise<QQChannel> {
    this.capabilities?.assert('guild.channel.get')
    return this.http.request<QQChannel>(findEndpoint('guild.channel.get'), {
      pathParams: { channel_id: channelId }
    })
  }

  async createChannel(guildId: string, input: QQChannelInput): Promise<QQChannel> {
    this.capabilities?.assert('guild.channels.create')
    return this.http.request<QQChannel>(findEndpoint('guild.channels.create'), {
      pathParams: { guild_id: guildId },
      body: input
    })
  }

  async updateChannel(channelId: string, input: Partial<QQChannelInput>): Promise<QQChannel> {
    this.capabilities?.assert('guild.channel.update')
    return this.http.request<QQChannel>(findEndpoint('guild.channel.update'), {
      pathParams: { channel_id: channelId },
      body: input
    })
  }

  async deleteChannel(channelId: string): Promise<void> {
    this.capabilities?.assert('guild.channel.delete')
    await this.http.request<unknown>(findEndpoint('guild.channel.delete'), {
      pathParams: { channel_id: channelId }
    })
  }
}
