import { describe, expect, it, vi } from 'vitest'
import type { QQGroupModule } from '../src/modules/groups'
import type { QQGuildModule } from '../src/modules/guilds'
import { QQCapabilityRegistry } from '../src/core/capability-registry'
import type { QQHttpClient } from '../src/core/http-client'
import { QQGroupModule as GroupModule } from '../src/modules/groups'
import { QQGuildModule as GuildModule } from '../src/modules/guilds'

const PUBLIC_MESSAGES = 1 << 25
const GUILDS = 1 << 0

function setup(
  result: unknown = {},
  intents: number = PUBLIC_MESSAGES | GUILDS
): {
  request: ReturnType<typeof vi.fn>
  groups: QQGroupModule
  guilds: QQGuildModule
} {
  const request = vi.fn(async () => result)
  const http = { request } as unknown as QQHttpClient
  const capabilities = new QQCapabilityRegistry({ env: 'production', intents })
  return {
    request,
    groups: new GroupModule({ http, capabilities }),
    guilds: new GuildModule({ http, capabilities })
  }
}

function lastCall(request: ReturnType<typeof vi.fn>): {
  endpoint: { id: string; path: string }
  options: Record<string, unknown>
} {
  const call = request.mock.calls[request.mock.calls.length - 1]
  if (!call) throw new Error('未发起请求')
  return {
    endpoint: call[0] as { id: string; path: string },
    options: call[1] as Record<string, unknown>
  }
}

describe('QQGroupModule', () => {
  it('info 与 member 使用路径参数', async () => {
    const { request, groups } = setup({ group_name: 'g' })

    await groups.info('group-1')
    expect(lastCall(request).endpoint.id).toBe('group.info')
    expect(lastCall(request).endpoint.path).toBe('/v2/groups/{group_openid}/info')
    expect(lastCall(request).options.pathParams).toEqual({ group_openid: 'group-1' })

    await groups.member('group-1', 'member-1')
    expect(lastCall(request).endpoint.id).toBe('group.members.get')
    expect(lastCall(request).endpoint.path).toBe(
      '/v2/groups/{group_openid}/members/{member_openid}'
    )
    expect(lastCall(request).options.pathParams).toEqual({
      group_openid: 'group-1',
      member_openid: 'member-1'
    })
  })

  it('members 传递分页 query 并解析成员数组', async () => {
    const { request, groups } = setup({
      members: [{ member_openid: 'member-1' }, { member_openid: 'member-2' }],
      next_cursor: 'next-1'
    })

    const result = await groups.members('group-1', { cursor: 'cursor-1', limit: 10 })

    expect(lastCall(request).endpoint.id).toBe('group.members.list')
    expect(lastCall(request).options.query).toEqual({ cursor: 'cursor-1', limit: 10 })
    expect(result.members).toEqual([
      { member_openid: 'member-1' },
      { member_openid: 'member-2' }
    ])
    expect(result.next_cursor).toBe('next-1')
  })

  it('removeMembers 发送 member_openids 请求体', async () => {
    const { request, groups } = setup()

    await groups.removeMembers('group-1', ['member-1', 'member-2'])

    expect(lastCall(request).endpoint.id).toBe('group.members.remove')
    expect(lastCall(request).options.body).toEqual({
      member_openids: ['member-1', 'member-2']
    })
  })

  it('approveJoinRequest 根据 approve 传入 op', async () => {
    const { request, groups } = setup()

    await groups.approveJoinRequest('group-1', 'member-1', true)
    expect(lastCall(request).endpoint.id).toBe('group.joinRequests.approve')
    expect(lastCall(request).options.pathParams).toEqual({
      group_openid: 'group-1',
      member_openid: 'member-1'
    })
    expect(lastCall(request).options.body).toEqual({ op: 'approve' })

    await groups.approveJoinRequest('group-1', 'member-1', false)
    expect(lastCall(request).options.body).toEqual({ op: 'decline' })
  })

  it('setJoinStrategyWhitelist 发送白名单请求体', async () => {
    const { request, groups } = setup()

    await groups.setJoinStrategyWhitelist('strategy-1', ['user-1', 'user-2'])

    expect(lastCall(request).endpoint.id).toBe('group.joinStrategies.whitelist')
    expect(lastCall(request).options.pathParams).toEqual({ strategy_id: 'strategy-1' })
    expect(lastCall(request).options.body).toEqual({
      op: 'add',
      whitelist_users: ['user-1', 'user-2']
    })
  })

  it('updateBlacklist 直接通知请求体', async () => {
    const { request, groups } = setup()

    await groups.updateBlacklist('group-1', { op: 'add', member_openids: ['member-1'] })

    expect(lastCall(request).endpoint.id).toBe('group.blacklist.update')
    expect(lastCall(request).options.body).toEqual({
      op: 'add',
      member_openids: ['member-1']
    })
  })

  it('setMute 直接通知请求体', async () => {
    const { request, groups } = setup()

    await groups.setMute('group-1', {
      members: [{ op: 'on', member_openid: 'member-1', mute_expire_at: '2026-11-02T00:00:00Z' }]
    })

    expect(lastCall(request).endpoint.id).toBe('group.mute.set')
    expect(lastCall(request).options.body).toEqual({
      members: [{ op: 'on', member_openid: 'member-1', mute_expire_at: '2026-11-02T00:00:00Z' }]
    })
  })

  it('listJoinStrategies 兼容对象与直接数组', async () => {
    const { request, groups } = setup()
    request.mockResolvedValueOnce({ strategies: [{ strategy_id: 'strategy-1' }] })
    request.mockResolvedValueOnce([{ strategy_id: 'strategy-2' }])

    expect(await groups.listJoinStrategies()).toEqual([{ strategy_id: 'strategy-1' }])
    expect(lastCall(request).endpoint.id).toBe('group.joinStrategies.list')
    expect(await groups.listJoinStrategies()).toEqual([{ strategy_id: 'strategy-2' }])
  })
})

describe('QQGuildModule', () => {
  it('channels 兼容对象与直接数组', async () => {
    const { request, guilds } = setup()
    request.mockResolvedValueOnce({ channels: [{ id: 'channel-1' }] })
    request.mockResolvedValueOnce([{ id: 'channel-2' }])

    expect(await guilds.channels('guild-1')).toEqual([{ id: 'channel-1' }])
    expect(lastCall(request).endpoint.id).toBe('guild.channels.list')
    expect(lastCall(request).options.pathParams).toEqual({ guild_id: 'guild-1' })
    expect(await guilds.channels('guild-1')).toEqual([{ id: 'channel-2' }])
  })

  it('createChannel 发送频道请求体', async () => {
    const { request, guilds } = setup({ id: 'channel-1' })

    const result = await guilds.createChannel('guild-1', { name: '闲聊', type: 0 })

    expect(lastCall(request).endpoint.id).toBe('guild.channels.create')
    expect(lastCall(request).options.pathParams).toEqual({ guild_id: 'guild-1' })
    expect(lastCall(request).options.body).toEqual({ name: '闲聊', type: 0 })
    expect(result).toEqual({ id: 'channel-1' })
  })

  it('updateChannel 发送局部频道请求体', async () => {
    const { request, guilds } = setup({ id: 'channel-1' })

    await guilds.updateChannel('channel-1', { name: '公告' })

    expect(lastCall(request).endpoint.id).toBe('guild.channel.update')
    expect(lastCall(request).options.pathParams).toEqual({ channel_id: 'channel-1' })
    expect(lastCall(request).options.body).toEqual({ name: '公告' })
  })

  it('intents 不足时 guild 能力抛出 CAPABILITY_UNAVAILABLE', async () => {
    const { guilds } = setup({}, PUBLIC_MESSAGES)

    await expect(guilds.get('guild-1')).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE'
    })
  })
})
