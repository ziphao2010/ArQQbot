import type {
  QQBlacklistEntry,
  QQBlacklistUpdate,
  QQGroupBotState,
  QQGroupInfo,
  QQGroupMember,
  QQGroupMembers,
  QQJoinRequest,
  QQJoinRequestList,
  QQJoinStrategy,
  QQMuteInput,
  QQMuteSetting,
  QQPageQuery
} from '@arqqbot/shared'
import type { QQCapabilityGuard } from '../core/capability-registry'
import type { QQHttpClient } from '../core/http-client'
import { findEndpoint } from '../core/endpoint-catalog'

export interface QQGroupModuleOptions {
  http: QQHttpClient
  capabilities?: QQCapabilityGuard
}

function asArray<T>(input: unknown, key: string): T[] {
  if (Array.isArray(input)) return input as T[]
  if (input && typeof input === 'object') {
    const value = (input as Record<string, unknown>)[key]
    if (Array.isArray(value)) return value as T[]
  }
  return []
}

function asNextCursor(input: unknown): string | undefined {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const value = (input as Record<string, unknown>).next_cursor
    if (typeof value === 'string') return value
  }
  return undefined
}

export class QQGroupModule {
  private readonly http: QQHttpClient
  private readonly capabilities?: QQCapabilityGuard

  constructor(options: QQGroupModuleOptions) {
    this.http = options.http
    this.capabilities = options.capabilities
  }

  async info(groupOpenid: string): Promise<QQGroupInfo> {
    this.capabilities?.assert('group.info')
    return this.http.request<QQGroupInfo>(findEndpoint('group.info'), {
      pathParams: { group_openid: groupOpenid }
    })
  }

  async botState(groupOpenid: string): Promise<QQGroupBotState> {
    this.capabilities?.assert('group.botState')
    return this.http.request<QQGroupBotState>(findEndpoint('group.botState'), {
      pathParams: { group_openid: groupOpenid }
    })
  }

  async members(groupOpenid: string, query?: QQPageQuery): Promise<QQGroupMembers> {
    this.capabilities?.assert('group.members.list')
    const result = await this.http.request<unknown>(findEndpoint('group.members.list'), {
      pathParams: { group_openid: groupOpenid },
      query
    })
    const payload: QQGroupMembers = {
      members: asArray<QQGroupMember>(result, 'members')
    }
    const nextCursor = asNextCursor(result)
    if (nextCursor) payload.next_cursor = nextCursor
    return payload
  }

  async member(groupOpenid: string, memberOpenid: string): Promise<QQGroupMember> {
    this.capabilities?.assert('group.members.get')
    return this.http.request<QQGroupMember>(findEndpoint('group.members.get'), {
      pathParams: { group_openid: groupOpenid, member_openid: memberOpenid }
    })
  }

  async removeMembers(groupOpenid: string, memberOpenids: string[]): Promise<void> {
    this.capabilities?.assert('group.members.remove')
    await this.http.request<unknown>(findEndpoint('group.members.remove'), {
      pathParams: { group_openid: groupOpenid },
      body: { member_openids: memberOpenids }
    })
  }

  async joinRequests(groupOpenid: string, query?: QQPageQuery): Promise<QQJoinRequestList> {
    this.capabilities?.assert('group.joinRequests.list')
    const result = await this.http.request<unknown>(findEndpoint('group.joinRequests.list'), {
      pathParams: { group_openid: groupOpenid },
      query
    })
    const payload: QQJoinRequestList = {
      list: asArray<QQJoinRequest>(result, 'list')
    }
    const nextCursor = asNextCursor(result)
    if (nextCursor) payload.next_cursor = nextCursor
    return payload
  }

  async approveJoinRequest(
    groupOpenid: string,
    memberOpenid: string,
    approve: boolean
  ): Promise<void> {
    this.capabilities?.assert('group.joinRequests.approve')
    await this.http.request<unknown>(findEndpoint('group.joinRequests.approve'), {
      pathParams: { group_openid: groupOpenid, member_openid: memberOpenid },
      body: { op: approve ? 'approve' : 'decline' }
    })
  }

  async createJoinStrategy(input: QQJoinStrategy): Promise<QQJoinStrategy> {
    this.capabilities?.assert('group.joinStrategies.create')
    return this.http.request<QQJoinStrategy>(findEndpoint('group.joinStrategies.create'), {
      body: input
    })
  }

  async updateJoinStrategy(
    id: string,
    input: Partial<QQJoinStrategy>
  ): Promise<QQJoinStrategy> {
    this.capabilities?.assert('group.joinStrategies.update')
    return this.http.request<QQJoinStrategy>(findEndpoint('group.joinStrategies.update'), {
      pathParams: { strategy_id: id },
      body: input
    })
  }

  async executeJoinStrategy(id: string): Promise<void> {
    this.capabilities?.assert('group.joinStrategies.execute')
    await this.http.request<unknown>(findEndpoint('group.joinStrategies.execute'), {
      pathParams: { strategy_id: id }
    })
  }

  async setJoinStrategyWhitelist(id: string, userIds: string[]): Promise<void> {
    this.capabilities?.assert('group.joinStrategies.whitelist')
    await this.http.request<unknown>(findEndpoint('group.joinStrategies.whitelist'), {
      pathParams: { strategy_id: id },
      body: { op: 'add', whitelist_users: userIds }
    })
  }

  async listJoinStrategies(): Promise<QQJoinStrategy[]> {
    this.capabilities?.assert('group.joinStrategies.list')
    const result = await this.http.request<unknown>(findEndpoint('group.joinStrategies.list'))
    return asArray<QQJoinStrategy>(result, 'strategies')
  }

  async deleteJoinStrategy(id: string): Promise<void> {
    this.capabilities?.assert('group.joinStrategies.delete')
    await this.http.request<unknown>(findEndpoint('group.joinStrategies.delete'), {
      pathParams: { strategy_id: id }
    })
  }

  async blacklist(groupOpenid: string): Promise<QQBlacklistEntry[]> {
    this.capabilities?.assert('group.blacklist.list')
    const result = await this.http.request<unknown>(findEndpoint('group.blacklist.list'), {
      pathParams: { group_openid: groupOpenid }
    })
    return asArray<QQBlacklistEntry>(result, 'blacklist')
  }

  async updateBlacklist(groupOpenid: string, input: QQBlacklistUpdate): Promise<void> {
    this.capabilities?.assert('group.blacklist.update')
    await this.http.request<unknown>(findEndpoint('group.blacklist.update'), {
      pathParams: { group_openid: groupOpenid },
      body: input
    })
  }

  async muteSetting(groupOpenid: string): Promise<QQMuteSetting> {
    this.capabilities?.assert('group.mute.get')
    return this.http.request<QQMuteSetting>(findEndpoint('group.mute.get'), {
      pathParams: { group_openid: groupOpenid }
    })
  }

  async setMute(groupOpenid: string, input: QQMuteInput): Promise<void> {
    this.capabilities?.assert('group.mute.set')
    await this.http.request<unknown>(findEndpoint('group.mute.set'), {
      pathParams: { group_openid: groupOpenid },
      body: input
    })
  }
}
